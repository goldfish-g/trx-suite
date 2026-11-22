import { describe, expect, it } from 'vitest';
import { EnginePackage, findPackageMetadata } from './package';

/** A package laid out as Emscripten's file packager does, with the script that describes it. */
function makePackage(contents: Record<string, string>, describedSize?: number) {
    const encoder = new TextEncoder();
    const files: { filename: string; start: number; end: number }[] = [];
    const parts: Uint8Array[] = [];
    let offset = 0;
    for (const [filename, text] of Object.entries(contents)) {
        const bytes = encoder.encode(text);
        files.push({ filename, start: offset, end: offset + bytes.length });
        parts.push(bytes);
        offset += bytes.length;
    }
    const metadata = { files, remote_package_size: describedSize ?? offset };
    const script = [
        'var Module = {};',
        // The loader's own code comes first, and mentions the call too.
        'function loadPackage(metadata) { var files = metadata["files"]; /* { not JSON } */ }',
        `  loadPackage(${JSON.stringify(metadata, null, 2)});`,
        '}))();',
        'var after = "the rest of the engine";',
    ].join('\n');
    return { script: new Blob([script], { type: 'text/javascript' }), data: new Blob(parts as BlobPart[]) };
}

const CONTENTS = {
    '/cfg/base_strings.json5': '{"strings": "{}"}',
    '/games/tr1/gameflow.json5': '{"name": "Tomb Raider"}',
    '/games/tr1/images/title.webp': 'TR1 TITLE',
    '/games/tr1-ub/gameflow.json5': '{\n    // A comment.\n    "engine": 1,\n    "extends": "tr1",\n}',
    '/games/tr1-ub/images/title_ub.webp': 'UB TITLE',
    '/games/tr2/gameflow.json5': '{"name": "Tomb Raider II"}',
    '/games/tr2/images/title.webp': 'TR2 TITLE',
    '/games/tr2-gm/gameflow.json5': '{"extends": "tr2"}',
    '/games/tr2-gm/levels/level1.tr2': 'GM LEVEL',
    '/scripts/weapons.lua': 'return {}',
};

function fakeFs() {
    const written = new Map<string, string>();
    return {
        written,
        writeFile: (path: string, data: Uint8Array, opts?: { canOwn?: boolean }) => {
            expect(opts?.canOwn).toBe(true);
            written.set(path, new TextDecoder().decode(data));
        },
    };
}

/** What the engine would read from a package: each file's bytes, by the script's table of contents. */
async function unpack(enginePackage: EnginePackage): Promise<Record<string, string>> {
    const found = findPackageMetadata(await enginePackage.script.text());
    expect(found).not.toBeNull();
    const bytes = new Uint8Array(await enginePackage.data.arrayBuffer());
    expect(found!.metadata.remote_package_size).toBe(bytes.length);
    return Object.fromEntries(
        found!.metadata.files.map((file) => [file.filename, new TextDecoder().decode(bytes.subarray(file.start, file.end))]),
    );
}

describe('EnginePackage', () => {
    it('finds the table of contents in the last loadPackage call, braces in its strings and all', () => {
        const script = 'loadPackage(metadata) {}\nloadPackage({"files": [{"filename": "/a{b}.txt", "start": 0, "end": 1}], "remote_package_size": 1});';
        const found = findPackageMetadata(script);
        expect(found?.metadata.files[0]?.filename).toBe('/a{b}.txt');
        expect(script.slice(found!.to)).toBe(');');
    });

    it('leaves out every game picture and level, keeping each as an empty file', async () => {
        const { script, data } = makePackage(CONTENTS);
        const split = await EnginePackage.split(script, data);
        const files = await unpack(split);
        expect(Object.keys(files)).toEqual(Object.keys(CONTENTS));
        expect(files['/games/tr1/images/title.webp']).toBe('');
        expect(files['/games/tr2-gm/levels/level1.tr2']).toBe('');
        expect(files['/cfg/base_strings.json5']).toBe(CONTENTS['/cfg/base_strings.json5']);
        expect(files['/games/tr1-ub/gameflow.json5']).toBe(CONTENTS['/games/tr1-ub/gameflow.json5']);
        expect(files['/scripts/weapons.lua']).toBe('return {}');
        // The rest of the script is untouched.
        const text = await split.script.text();
        expect(text.startsWith('var Module = {};\nfunction loadPackage(metadata)')).toBe(true);
        expect(text.endsWith(');\n}))();\nvar after = "the rest of the engine";')).toBe(true);
    });

    it('fills in the files of the game played and of the games it extends, and no others', async () => {
        const { script, data } = makePackage(CONTENTS);
        const split = await EnginePackage.split(script, data);
        const fs = fakeFs();
        const bytes = await split.fill(fs, ['tr1-ub']);
        expect(Object.fromEntries(fs.written)).toEqual({
            '/games/tr1/images/title.webp': 'TR1 TITLE',
            '/games/tr1-ub/images/title_ub.webp': 'UB TITLE',
        });
        expect(bytes).toBe('TR1 TITLE'.length + 'UB TITLE'.length);
        expect([...split.gamesWith(['tr2-gm', 'custom-level'])].sort()).toEqual(['custom-level', 'tr2', 'tr2-gm']);
    });

    it('loads whole a package its script does not describe', async () => {
        const { script, data } = makePackage(CONTENTS, 12345);
        const whole = await EnginePackage.split(script, data);
        expect(whole.script).toBe(script);
        expect(whole.data).toBe(data);
        const fs = fakeFs();
        expect(await whole.fill(fs, ['tr1'])).toBe(0);
        expect(fs.written.size).toBe(0);
    });

    it('loads whole a package whose script it cannot read', async () => {
        const script = new Blob(['var Module = {}; loadPackage(metadataFromSomewhere);']);
        const data = new Blob(['x']);
        const whole = await EnginePackage.split(script, data);
        expect(whole.script).toBe(script);
        expect(whole.data).toBe(data);
    });
});
