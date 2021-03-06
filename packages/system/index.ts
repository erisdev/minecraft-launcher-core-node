import { open, CachedZipFile } from "@xmcl/unzip";
import { access, stat, writeFile, readFile, readdir } from "fs";
import { join, sep } from "path";
import { FileSystem } from "./system";
import { promisify } from "util";

const paccess = promisify(access);
const pstat = promisify(stat);
const pwriteFile = promisify(writeFile);
const preadFile = promisify(readFile);
const preaddir = promisify(readdir);

export async function openFileSystem(basePath: string | Uint8Array): Promise<FileSystem> {
    if (typeof basePath === "string") {
        const stat = await pstat(basePath);
        if (stat.isDirectory()) {
            return new NodeFileSystem(basePath);
        } else {
            const zip = await open(basePath, { lazyEntries: false });
            return new NodeZipFileSystem(basePath, zip);
        }
    } else {
        const zip = await open(basePath as Buffer, { lazyEntries: false });
        return new NodeZipFileSystem("", zip);
    }
}
export function resolveFileSystem(base: string | Uint8Array | FileSystem): Promise<FileSystem> {
    if (typeof base === "string" || base instanceof Uint8Array) {
        return openFileSystem(base);
    } else {
        return Promise.resolve(base);
    }
}

class NodeFileSystem extends FileSystem {
    sep = sep;
    type = "path" as const;
    writeable = true;
    join(...paths: string[]): string {
        return join(...paths);
    }
    getUrl(name: string) {
        return `file://${this.join(this.root, name)}`;
    }
    isDirectory(name: string): Promise<boolean> {
        return pstat(join(this.root, name)).then((s) => s.isDirectory());
    }
    writeFile(name: string, data: Uint8Array): Promise<void> {
        return pwriteFile(join(this.root, name), data);
    }
    existsFile(name: string): Promise<boolean> {
        return paccess(join(this.root, name)).then(() => true, () => false);
    }
    readFile(name: any, encoding?: any) {
        return preadFile(join(this.root, name), { encoding }) as any;
    }
    listFiles(name: string): Promise<string[]> {
        return preaddir(join(this.root, name));
    }
    constructor(readonly root: string) { super(); }
}
class NodeZipFileSystem extends FileSystem {
    sep = "/";
    type = "zip" as const;
    writeable = false;

    join(...paths: string[]): string {
        return paths.join("/");
    }
    isDirectory(name: string): Promise<boolean> {
        if (this.zip.entries[name]) {
            return Promise.resolve(name.endsWith("/"));
        }
        if (this.zip.entries[name + "/"]) {
            return Promise.resolve(true);
        }
        // the root dir won't have entries
        // therefore we need to do an extra track here
        const entries = Object.keys(this.zip.entries);
        return Promise.resolve(entries.some((e) => e.startsWith(name + "/")));
    }
    existsFile(name: string): Promise<boolean> {
        name = name.startsWith("/") ? name.substring(1) : name;
        if (this.zip.entries[name]
            || this.zip.entries[name + "/"]) { return Promise.resolve(true); }
        // the root dir won't have entries
        // therefore we need to do an extra track here
        const entries = Object.keys(this.zip.entries);
        return Promise.resolve(entries.some((e) => e.startsWith(name + "/")));
    }
    async readFile(name: string, encoding?: "utf-8" | "base64"): Promise<any> {
        const entry = this.zip.entries[name];
        if (!entry) { throw new Error(`Not found file named ${name}`); }
        const buffer = await this.zip.readEntry(entry);
        if (encoding === "utf-8") {
            return buffer.toString("utf-8");
        }
        if (encoding === "base64") {
            return buffer.toString("base64");
        }
        return buffer;
    }
    listFiles(name: string): Promise<string[]> {
        name = name.startsWith("/") ? name.substring(1) : name;
        return Promise.resolve([
            ...new Set(Object.keys(this.zip.entries)
                .filter((n) => n.startsWith(name))
                .map((n) => n.substring(name.length))
                .map((n) => n.startsWith("/") ? n.substring(1) : n)
                .map((n) => n.split("/")[0])),
        ]);
    }
    async walkFiles(startingDir: string, walker: (path: string) => void | Promise<void>) {
        const root = startingDir.startsWith("/") ? startingDir.substring(1) : startingDir;
        for (const child of Object.keys(this.zip.entries).filter((e) => e.startsWith(root))) {
            if (child.endsWith("/")) { continue; }
            const result = walker(child);
            if (result instanceof Promise) {
                await result;
            }
        }
    }
    constructor(readonly root: string, private zip: CachedZipFile) { super(); }
}

export * from "./system";

