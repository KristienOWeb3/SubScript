package com.subscriptonarc.subscript_mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    companion object {
        private const val CHANNEL = "com.subscriptonarc.mobile/native"
        private const val WEB_FLOW_REQUEST = 4201
    }

    private var pendingWebFlow: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            CHANNEL,
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "getSessionCookie" -> result.success(SessionStore.load(this))
                "saveSessionCookie" -> {
                    val cookie = call.argument<String>("cookie").orEmpty()
                    if (cookie.isBlank()) {
                        result.error("invalid_cookie", "The session cookie is empty.", null)
                    } else {
                        SessionStore.save(this, cookie)
                        result.success(null)
                    }
                }
                "clearSession" -> {
                    SessionStore.clear(this)
                    CookieManager.getInstance().removeAllCookies(null)
                    CookieManager.getInstance().flush()
                    result.success(null)
                }
                "startWebLogin" -> startWebFlow(
                    AuthActivity.LOGIN_URL,
                    true,
                    result,
                )
                "openWebRoute" -> {
                    val url = call.argument<String>("url").orEmpty()
                    if (!isTrustedProductUrl(url)) {
                        result.error("invalid_url", "Only SubScript HTTPS routes are allowed.", null)
                    } else {
                        startWebFlow(url, false, result)
                    }
                }
                "getInitialLink" -> {
                    val link = intent?.data?.toString()
                    intent?.data = null
                    result.success(link)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun startWebFlow(
        url: String,
        finishOnSession: Boolean,
        result: MethodChannel.Result,
    ) {
        if (pendingWebFlow != null) {
            result.error("flow_active", "A web flow is already open.", null)
            return
        }

        pendingWebFlow = result
        val intent = Intent(this, AuthActivity::class.java).apply {
            putExtra(AuthActivity.EXTRA_URL, url)
            putExtra(AuthActivity.EXTRA_FINISH_ON_SESSION, finishOnSession)
        }
        startActivityForResult(intent, WEB_FLOW_REQUEST)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == WEB_FLOW_REQUEST) {
            val result = pendingWebFlow
            pendingWebFlow = null

            if (resultCode == Activity.RESULT_OK) {
                result?.success(data?.getStringExtra(AuthActivity.RESULT_COOKIE))
            } else {
                result?.success(null)
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val link = intent.data?.toString() ?: return
        if (!isTrustedProductUrl(link)) return

        startActivity(
            Intent(this, AuthActivity::class.java).apply {
                putExtra(AuthActivity.EXTRA_URL, link)
                putExtra(AuthActivity.EXTRA_FINISH_ON_SESSION, false)
            },
        )
        intent.data = null
    }

    private fun isTrustedProductUrl(value: String): Boolean {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        val host = uri.host?.lowercase() ?: return false
        return uri.scheme == "https" &&
            (host == "subscriptonarc.com" || host.endsWith(".subscriptonarc.com"))
    }
}
