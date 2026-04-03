# Proposal: Local Device Gemma for Image/Text Understanding on iOS

## Overview
This proposal outlines a solution to replace the cloud-based OpenRouter dependency with a local, on-device Gemma model for joint image/text understanding. We will deploy the existing web client as an iOS application using Capacitor and leverage a native iOS Machine Learning framework to run PaliGemma (Google's Vision-Language Gemma model) directly on the user's device.

## 1. iOS App Shell via Capacitor
Since the project already has iOS Capacitor rules (`.cursor/rules/ios-cursor-rule`), we will initialize Capacitor in the `web-client` to create the iOS app shell.
- Run `npx cap init` in the web client directory.
- Add the `@capacitor/ios` package and run `npx cap add ios`.
- Update the build scripts to sync the web distribution to the iOS project.

## 2. Native ML Integration (MLC LLM / MediaPipe)
To run a multimodal Gemma model (PaliGemma) on-device:
- **Framework Choice**: Use **MLC LLM** (Machine Learning Compilation) for iOS, which has excellent Metal/WebGPU support for Gemma and multimodal variants, or the **MediaPipe LLM Inference API** (which officially supports Gemma 2B/7B). For joint image/text, PaliGemma via MLC LLM is the most robust current option.
- **Capacitor Plugin**: Create a local Capacitor plugin (e.g., `capacitor-plugin-local-llm`) with Swift code that loads the `.gguf` or MLC compiled model weights.
- The Swift plugin will expose a method to the web layer: `generate(prompt: String, imageBase64: String) -> Promise<{ text: String }>`.

## 3. Update Agent Core to Route to Local LLM
Modify `MiraChat/packages/agent-core/src/openrouter-assist.ts` to intercept calls when running on-device.
- Introduce a runtime check (e.g., `Capacitor.isNativePlatform()`).
- In `openRouterDesktopContextAnalysis` and `openRouterPrimaryReplyDraft`, check if the local LLM plugin is available.
- If available, format the prompt and base64 image, then call the Capacitor plugin instead of `fetch(OPENROUTER_URL)`.

```typescript
// Example interception in openrouter-assist.ts
import { Capacitor } from '@capacitor/core';
import { LocalLLM } from 'capacitor-plugin-local-llm';

export async function openRouterDesktopContextAnalysis(input: OpenRouterDesktopContextInput) {
  if (Capacitor.isNativePlatform()) {
    // Route to on-device Gemma
    const result = await LocalLLM.generate({
      prompt: buildDesktopContextSystemPrompt(true) + "\n" + userContentText,
      imageBase64: input.screenshotImageBase64
    });
    return parseOpenRouterDesktopContextJson(result.text);
  }
  // ... fallback to existing OpenRouter fetch ...
}
```

## 4. Model Weight Distribution
- **Quantization**: Download the quantized PaliGemma weights (e.g., 3B or 2B parameter 4-bit quantized to fit in iOS RAM limitations).
- **Delivery**: Implement a first-run download mechanism in the Swift plugin to fetch the ~2GB weights from a CDN. This keeps the initial App Store binary small and allows for model updates independent of app releases. Alternatively, bundle the weights directly in the iOS app bundle (`ios/App/App/Models/`) if an offline-first installation is strictly required.