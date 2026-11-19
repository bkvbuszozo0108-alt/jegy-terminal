package hu.vizor.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * VIZOR rendszám matrica leolvasó: a web-app (GitHub Pages) teljes képernyőn, saját appként.
 * Zebra DataWedge: a szkenner Intenttel küldi a kódot, az app a web-app window.jegyScan függvényének adja át,
 * így nem kell beviteli mező, billentyűzet vagy Enter.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var offline: LinearLayout
    private var failed = false
    private var pending: String? = null
    private val url get() = getString(R.string.app_url)

    private val scanRx = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            val code = i?.getStringExtra("com.symbol.datawedge.data_string") ?: return
            inject(code)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0F2A1C"))
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.userAgentString = s.userAgentString + " VizorApp/1.0"
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url.toString()
                if (u.startsWith(url)) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } catch (e: Exception) {}
                return true
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) { failed = true; offline.visibility = View.VISIBLE }
            }
            override fun onPageFinished(view: WebView, u: String) {
                if (!failed) offline.visibility = View.GONE
            }
        }

        offline = LinearLayout(this)
        offline.orientation = LinearLayout.VERTICAL
        offline.gravity = Gravity.CENTER
        offline.setBackgroundColor(Color.parseColor("#0F2A1C"))
        offline.setPadding(48, 48, 48, 48)
        offline.visibility = View.GONE
        val msg = TextView(this)
        msg.text = "Nincs internet.\nAz első indításhoz internet kell, utána az app anélkül is megnyílik."
        msg.setTextColor(Color.WHITE)
        msg.textSize = 18f
        msg.gravity = Gravity.CENTER
        val retry = Button(this)
        retry.text = "Újra"
        retry.setOnClickListener { load() }
        offline.addView(msg)
        offline.addView(retry)

        val root = FrameLayout(this)
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(offline, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        setupDataWedge()
        intent?.getStringExtra("com.symbol.datawedge.data_string")?.let { pending = it }
        load()
    }

    private fun load() {
        failed = false
        offline.visibility = View.GONE
        web.loadUrl(url)
    }

    private fun inject(code: String) {
        val js = "(function(c){if(typeof window.jegyScan==='function'){window.jegyScan(c);return 1}return 0})(" + JSONObject.quote(code) + ")"
        runOnUiThread {
            try { web.evaluateJavascript(js) { r -> if (r != "1") pending = code } } catch (e: Exception) { pending = code }
        }
    }

    /** Zebra DataWedge profil ehhez az apphoz: Intent kimenet be, billentyű-kimenet ki. Nem Zebra készüléken nem csinál semmit. */
    private fun setupDataWedge() {
        try {
            val app = Bundle().apply { putString("PACKAGE_NAME", packageName); putStringArray("ACTIVITY_LIST", arrayOf("*")) }
            fun cfg(plugin: Bundle, mode: String = "CREATE_IF_NOT_EXIST") = Bundle().apply {
                putString("PROFILE_NAME", PROFILE); putString("PROFILE_ENABLED", "true"); putString("CONFIG_MODE", mode)
                putParcelableArray("APP_LIST", arrayOf(app)); putBundle("PLUGIN_CONFIG", plugin)
            }
            val barcode = Bundle().apply {
                putString("PLUGIN_NAME", "BARCODE"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply {
                    putString("scanner_selection", "auto"); putString("scanner_input_enabled", "true")
                    putString("decoder_ean13", "true"); putString("decoder_ean8", "true"); putString("decoder_upca", "true"); putString("decoder_upce0", "true")
                    putString("decoder_code128", "true"); putString("decoder_code39", "true"); putString("decoder_i2of5", "true")
                    putString("decoder_qrcode", "true"); putString("decoder_datamatrix", "true")
                })
            }
            val intentOut = Bundle().apply {
                putString("PLUGIN_NAME", "INTENT"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply { putString("intent_output_enabled", "true"); putString("intent_action", SCAN_ACTION); putString("intent_delivery", "2") })
            }
            val keys = Bundle().apply {
                putString("PLUGIN_NAME", "KEYSTROKE"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply { putString("keystroke_output_enabled", "false") })
            }
            dw("com.symbol.datawedge.api.ENABLE_DATAWEDGE", true)
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION_ENABLEDATAWEDGE").putExtra("com.symbol.datawedge.api.EXTRA_PARAMETER", true))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(barcode)))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(intentOut, "UPDATE")))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(keys, "UPDATE")))
            dw("com.symbol.datawedge.api.SWITCH_TO_PROFILE", PROFILE)
            dw("com.symbol.datawedge.api.SCANNER_INPUT_PLUGIN", "ENABLE_PLUGIN")
        } catch (e: Exception) { /* nem Zebra eszköz */ }
    }

    private fun dw(key: String, value: Any) {
        val i = Intent("com.symbol.datawedge.api.ACTION")
        when (value) { is Boolean -> i.putExtra(key, value); else -> i.putExtra(key, value.toString()) }
        sendBroadcast(i)
    }

    override fun onResume() {
        super.onResume()
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(scanRx, IntentFilter(SCAN_ACTION), RECEIVER_EXPORTED) else registerReceiver(scanRx, IntentFilter(SCAN_ACTION))
        try { dw("com.symbol.datawedge.api.SWITCH_TO_PROFILE", PROFILE) } catch (e: Exception) {}
        web.onResume()
        pending?.let { pending = null; web.postDelayed({ inject(it) }, 800) }
    }

    override fun onPause() {
        super.onPause()
        try { unregisterReceiver(scanRx) } catch (e: Exception) {}
        web.onPause()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.getStringExtra("com.symbol.datawedge.data_string")?.let { inject(it) }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    companion object {
        const val SCAN_ACTION = "hu.vizor.SCAN"
        const val PROFILE = "Vizor"
    }
}
