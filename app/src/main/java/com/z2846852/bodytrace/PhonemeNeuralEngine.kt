package com.z2846852.bodytrace

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineZipformerCtcModelConfig
import java.io.File

/**
 * Real neural IPA phone decoding from an entire short PCM utterance.
 * ZIPA is CTC, not word-ASR; no English spelling-to-IPA conversion.
 *
 * Runtime: pinned prebuilt official sherpa-onnx Android AAR (Kotlin + JNI).
 * Weights/tokens: opt-in SHA256 verified model pack under private files dir,
 * NEVER in APK. 16 kHz mono PCM, 80-dim fbank with no dithering.
 */
class PhonemeNeuralEngine {
    fun decode(modelDir: File, pcm: ShortArray, count: Int): Array<String> {
        require(modelDir.isDirectory)
        require(count in 1600..pcm.size)
        val model=File(modelDir,"model.int8.onnx")
        val tokens=File(modelDir,"tokens.txt")
        require(model.isFile&&tokens.isFile)
        val config=OfflineRecognizerConfig(
            featConfig=FeatureConfig(sampleRate=16000,featureDim=80,dither=0.0f),
            modelConfig=OfflineModelConfig(
                zipformerCtc=OfflineZipformerCtcModelConfig(model=model.absolutePath),
                tokens=tokens.absolutePath,
                numThreads=2,
                debug=false,
                provider="cpu",
            ),
            decodingMethod="greedy_search",
        )
        val samples=FloatArray(count){pcm[it]/32768.0f}
        val recognizer=OfflineRecognizer(config=config)
        try{
            val stream=recognizer.createStream()
            try{
                stream.acceptWaveform(samples,16000)
                recognizer.decode(stream)
                // Model emits actual IPA phone labels (plus boundary markers).
                // Do not normalize towards a presumed word/pronunciation.
                return recognizer.getResult(stream).tokens.asSequence()
                    .map{it.trim()}
                    .filter{it.isNotEmpty()&&it!="▁"&&
                        !it.startsWith("<")&&!it.startsWith("[")&&it!="|"&&it!="-"}
                    .take(96).toList().toTypedArray()
            }finally{stream.release()}
        }finally{recognizer.release()}
    }
}
