package app.sahayak.voice

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.util.Locale
import java.util.concurrent.Executors

@InvokeArg
class LangArgs {
    var lang: String = "hi-IN"
}

@InvokeArg
class SpeakArgs {
    var text: String = ""
    var lang: String = "hi-IN"
}

@InvokeArg
class ListenArgs {
    var lang: String = "hi-IN"
    lateinit var onPartial: Channel
}

private const val ALIAS_MIC = "microphone"

/**
 * Speech-to-text that stays on the phone.
 *
 * Android 12+ with an on-device recogniser: audio is processed locally.
 * Older phones: the system recogniser is asked to prefer offline models.
 */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = ALIAS_MIC)])
class VoicePlugin(private val activity: Activity) : Plugin(activity) {
    private var recognizer: SpeechRecognizer? = null
    private val background = Executors.newSingleThreadExecutor()

    private fun onDeviceAvailable(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)

    private fun recognizeIntent(lang: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
    }

    @Command
    fun status(invoke: Invoke) {
        val args = invoke.parseArgs(LangArgs::class.java)
        val ret = JSObject()
        ret.put("available", SpeechRecognizer.isRecognitionAvailable(activity))
        ret.put("onDevice", onDeviceAvailable())
        ret.put("permission", getPermissionState(ALIAS_MIC)?.toString() ?: "prompt")
        ret.put("sdk", Build.VERSION.SDK_INT)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !onDeviceAvailable()) {
            // Language-pack status can only be queried on Android 13+.
            ret.put("languageInstalled", "unknown")
            invoke.resolve(ret)
            return
        }
        activity.runOnUiThread {
            val probe = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
            probe.checkRecognitionSupport(recognizeIntent(args.lang), background, object : RecognitionSupportCallback {
                override fun onSupportResult(support: RecognitionSupport) {
                    val prefix = args.lang.substringBefore('-').lowercase()
                    fun has(list: List<String>) = list.any { it.lowercase().startsWith(prefix) }
                    ret.put(
                        "languageInstalled",
                        when {
                            has(support.installedOnDeviceLanguages) -> "installed"
                            has(support.pendingOnDeviceLanguages) -> "downloading"
                            has(support.supportedOnDeviceLanguages) -> "downloadable"
                            else -> "unsupported"
                        }
                    )
                    activity.runOnUiThread { probe.destroy() }
                    invoke.resolve(ret)
                }

                override fun onError(error: Int) {
                    ret.put("languageInstalled", "unknown")
                    activity.runOnUiThread { probe.destroy() }
                    invoke.resolve(ret)
                }
            })
        }
    }

    @Command
    fun listen(invoke: Invoke) {
        if (getPermissionState(ALIAS_MIC) != PermissionState.GRANTED) {
            requestPermissionForAlias(ALIAS_MIC, invoke, "micPermissionCallback")
            return
        }
        startListening(invoke)
    }

    @PermissionCallback
    private fun micPermissionCallback(invoke: Invoke) {
        if (getPermissionState(ALIAS_MIC) == PermissionState.GRANTED) {
            startListening(invoke)
        } else {
            invoke.reject("Microphone permission was not given", "PERMISSION_DENIED")
        }
    }

    private fun startListening(invoke: Invoke) {
        val args = invoke.parseArgs(ListenArgs::class.java)
        activity.runOnUiThread {
            recognizer?.destroy()
            val onDevice = onDeviceAvailable()
            val r = if (onDevice) {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
            } else {
                SpeechRecognizer.createSpeechRecognizer(activity)
            }
            recognizer = r
            r.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) = event(args, "state", "listening")
                override fun onBeginningOfSpeech() = event(args, "state", "hearing")
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() = event(args, "state", "processing")

                override fun onPartialResults(partialResults: Bundle?) {
                    val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    if (!text.isNullOrBlank()) event(args, "partial", text)
                }

                override fun onResults(results: Bundle?) {
                    val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: arrayListOf()
                    val ret = JSObject()
                    ret.put("text", list.firstOrNull() ?: "")
                    ret.put("alternatives", JSONArray(list))
                    ret.put("onDevice", onDevice)
                    invoke.resolve(ret)
                    release()
                }

                override fun onError(error: Int) {
                    invoke.reject(errorMessage(error), "SPEECH_$error")
                    release()
                }

                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            r.startListening(recognizeIntent(args.lang))
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        activity.runOnUiThread { recognizer?.stopListening() }
        invoke.resolve(JSObject())
    }

    @Command
    fun downloadLanguage(invoke: Invoke) {
        val args = invoke.parseArgs(LangArgs::class.java)
        val ret = JSObject()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && onDeviceAvailable()) {
            activity.runOnUiThread {
                val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
                r.triggerModelDownload(recognizeIntent(args.lang))
                r.destroy()
                ret.put("started", true)
                invoke.resolve(ret)
            }
        } else {
            // Older phones: open the system voice-input settings where offline languages are managed.
            activity.startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            ret.put("started", false)
            ret.put("openedSettings", true)
            invoke.resolve(ret)
        }
    }

    // ------------------------------ read aloud ------------------------------

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    @Command
    fun speak(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakArgs::class.java)
        val say: (TextToSpeech) -> Unit = { engine ->
            val result = engine.setLanguage(Locale.forLanguageTag(args.lang))
            val ret = JSObject()
            ret.put("voiceInstalled", result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED)
            engine.speak(args.text, TextToSpeech.QUEUE_FLUSH, null, "sahayak")
            invoke.resolve(ret)
        }
        val engine = tts
        if (engine != null && ttsReady) {
            say(engine)
            return
        }
        tts = TextToSpeech(activity) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                tts?.let(say)
            } else {
                invoke.reject("Text-to-speech is not available on this phone")
            }
        }
    }

    @Command
    fun stopSpeaking(invoke: Invoke) {
        tts?.stop()
        invoke.resolve(JSObject())
    }

    private fun event(args: ListenArgs, key: String, value: String) {
        val data = JSObject()
        data.put(key, value)
        args.onPartial.send(data)
    }

    private fun release() {
        activity.runOnUiThread {
            recognizer?.destroy()
            recognizer = null
        }
    }

    private fun errorMessage(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn't catch that. Please speak again."
        SpeechRecognizer.ERROR_AUDIO -> "Microphone problem"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission was not given"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER ->
            "Offline Hindi voice is not installed on this phone"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Voice input is busy, try again"
        else -> "Voice input error ($code)"
    }
}
