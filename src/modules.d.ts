declare module "*.css" {
	const content: string;
	export default content;
}

declare module "*.wasm" {
	const wasmModule: WebAssembly.Module;
	export default wasmModule;
}

declare module "*.ttf" {
	const data: ArrayBuffer;
	export default data;
}
