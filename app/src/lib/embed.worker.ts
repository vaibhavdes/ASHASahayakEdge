// paraphrase-multilingual-MiniLM-L12-v2 (int8 ONNX), same model as the cloud's fastembed.
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
// Bundle the ONNX Runtime wasm instead of loading it from a CDN.
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

export const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

type In =
  | { type: "load"; remoteHost?: string }
  | { type: "embed"; id: number; texts: string[] };

let extractor: FeatureExtractionPipeline | null = null;

env.backends.onnx.wasm!.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
env.backends.onnx.wasm!.numThreads = 1;
env.allowLocalModels = false;
env.useBrowserCache = true; // after the first download the model is served from cache, offline

self.onmessage = async (event: MessageEvent<In>) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      if (msg.remoteHost) env.remoteHost = msg.remoteHost;
      extractor = (await pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p: any) => self.postMessage({ type: "progress", progress: p }),
      })) as FeatureExtractionPipeline;
      self.postMessage({ type: "ready" });
      return;
    }
    if (!extractor) throw new Error("model not loaded");
    const output = await extractor(msg.texts, { pooling: "mean", normalize: true });
    self.postMessage({ type: "vectors", id: msg.id, vectors: output.tolist() });
  } catch (err) {
    self.postMessage({ type: "error", id: (msg as any).id, error: String(err) });
  }
};
