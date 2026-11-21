// UnRAR's WebAssembly as base64, which vite.checker.config.ts puts in the
// server's checker (check.ts), so it needs no file beside it.
declare module 'virtual:unrar-wasm' {
    const base64: string;
    export default base64;
}
