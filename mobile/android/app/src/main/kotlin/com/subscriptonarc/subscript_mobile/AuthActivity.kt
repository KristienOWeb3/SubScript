package com.subscriptonarc.subscript_mobile

import android.Manifest
import android.app.Activity
import android.app.Dialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

class AuthActivity : Activity() {
    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_FINISH_ON_SESSION = "finish_on_session"
        const val RESULT_COOKIE = "session_cookie"
        const val LOGIN_URL = "https://www.subscriptonarc.com/login"

        private const val PRODUCT_ORIGIN = "https://www.subscriptonarc.com"
        private const val FILE_CHOOSER_REQUEST = 4301
        private const val CAMERA_PERMISSION_REQUEST = 4302
    }

    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var finishOnSession = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(6, 6, 8)
        window.navigationBarColor = Color.rgb(6, 6, 8)
        finishOnSession = intent.getBooleanExtra(EXTRA_FINISH_ON_SESSION, false)

        CookieManager.getInstance().setAcceptCookie(true)
        webView = WebView(this).also {
            it.setBackgroundColor(Color.rgb(6, 6, 8))
            it.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        configureWebView(webView)
        setContentView(webView)

        val requestedUrl = intent.getStringExtra(EXTRA_URL).orEmpty()
        webView.loadUrl(if (isTrustedUrl(requestedUrl)) requestedUrl else LOGIN_URL)
    }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView(target: WebView, popupDialog: Dialog? = null) {
        target.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadsImagesAutomatically = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            allowFileAccess = false
            allowContentAccess = true
            setGeolocationEnabled(false)
            val packageVersion = packageManager
                .getPackageInfo(packageName, 0)
                .versionName
                ?: "1.0"
            userAgentString = "$userAgentString SubScriptAndroid/$packageVersion"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }
        }

        CookieManager.getInstance().setAcceptThirdPartyCookies(target, true)
        val isDebuggable =
            applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        WebView.setWebContentsDebuggingEnabled(isDebuggable)

        target.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean = handleNavigation(request.url, popupDialog != null)

            override fun onPageFinished(view: WebView, url: String) {
                CookieManager.getInstance().flush()
                if (popupDialog == null) completeLoginIfReady(url)
                super.onPageFinished(view, url)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame && popupDialog == null) {
                    showOfflinePage()
                }
                super.onReceivedError(view, request, error)
            }
        }

        target.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message,
            ): Boolean {
                if (!isUserGesture) return false

                val dialog = Dialog(
                    this@AuthActivity,
                    android.R.style.Theme_Black_NoTitleBar_Fullscreen,
                )
                val popup = WebView(this@AuthActivity)
                configureWebView(popup, dialog)
                dialog.setContentView(
                    popup,
                    ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )
                dialog.setOnDismissListener {
                    popup.stopLoading()
                    popup.destroy()
                }
                dialog.show()

                val transport = resultMsg.obj as WebView.WebViewTransport
                transport.webView = popup
                resultMsg.sendToTarget()
                return true
            }

            override fun onCloseWindow(window: WebView) {
                popupDialog?.dismiss()
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                this@AuthActivity.fileChooserCallback?.onReceiveValue(null)
                this@AuthActivity.fileChooserCallback = filePathCallback
                return try {
                    startActivityForResult(
                        Intent.createChooser(
                            fileChooserParams.createIntent(),
                            "Choose a file",
                        ),
                        FILE_CHOOSER_REQUEST,
                    )
                    true
                } catch (_: Exception) {
                    this@AuthActivity.fileChooserCallback = null
                    filePathCallback.onReceiveValue(null)
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val wantsCamera = request.resources.contains(
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE,
                    )
                    if (!isProductHost(request.origin.host) || !wantsCamera) {
                        request.deny()
                        return@runOnUiThread
                    }
                    if (
                        checkSelfPermission(Manifest.permission.CAMERA) ==
                        PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        pendingWebPermissionRequest = request
                        requestPermissions(
                            arrayOf(Manifest.permission.CAMERA),
                            CAMERA_PERMISSION_REQUEST,
                        )
                    }
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingWebPermissionRequest === request) {
                    pendingWebPermissionRequest = null
                }
            }
        }

        target.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            downloadFile(url, userAgent, contentDisposition, mimeType)
        }
    }

    private fun completeLoginIfReady(url: String) {
        if (!finishOnSession) return
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
        val path = uri.path.orEmpty()
        val reachedAuthenticatedRoute =
            isProductHost(uri.host) &&
                (uri.host?.startsWith("dashboard.") == true ||
                    path.startsWith("/user") ||
                    path.startsWith("/merchant") ||
                    path.startsWith("/dashboard"))
        if (!reachedAuthenticatedRoute) return

        val cookieSources = listOf(
            CookieManager.getInstance().getCookie(url),
            CookieManager.getInstance().getCookie(PRODUCT_ORIGIN),
            CookieManager.getInstance().getCookie("https://dashboard.subscriptonarc.com"),
        )
        val cookie = cookieSources
            .asSequence()
            .filterNotNull()
            .mapNotNull {
                Regex("""(?:^|;\s*)(subscript_session_token=[^;]+)""")
                    .find(it)
                    ?.groupValues
                    ?.getOrNull(1)
            }
            .firstOrNull()
            ?: return

        SessionStore.save(this, cookie)
        setResult(
            RESULT_OK,
            Intent().putExtra(RESULT_COOKIE, cookie),
        )
        finish()
    }

    private fun handleNavigation(uri: Uri, insidePopup: Boolean): Boolean {
        val scheme = uri.scheme?.lowercase()
        if (scheme == "http" || scheme == "https") {
            if (insidePopup || isProductHost(uri.host)) return false
            openExternal(uri)
            return true
        }
        openExternal(uri)
        return true
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun downloadFile(
        url: String,
        userAgent: String,
        contentDisposition: String,
        mimeType: String,
    ) {
        try {
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                setTitle(fileName)
                setDescription("Downloaded from SubScript")
                setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                )
                setDestinationInExternalFilesDir(
                    this@AuthActivity,
                    Environment.DIRECTORY_DOWNLOADS,
                    fileName,
                )
                addRequestHeader("User-Agent", userAgent)
                CookieManager.getInstance().getCookie(url)?.let {
                    addRequestHeader("Cookie", it)
                }
            }
            val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            manager.enqueue(request)
            Toast.makeText(this, "Download started.", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Could not download this file.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showOfflinePage() {
        val html = """
            <!doctype html><html lang="en"><head>
            <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
            <style>
            *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
            background:#060608;color:#fff;font-family:system-ui;padding:28px;text-align:center}
            main{max-width:360px}.mark{width:64px;height:64px;margin:0 auto 24px;border:1px solid #ccff004d;
            border-radius:20px;display:grid;place-items:center;color:#ccff00;font-weight:900;font-size:24px;
            background:#ccff0014}h1{font-size:24px;margin:0 0 12px;font-weight:900;text-transform:uppercase}
            p{color:#ffffff8c;line-height:1.6;margin:0 0 24px}button{width:100%;border:1px solid #ccff004d;
            background:#ccff001a;color:#fff;border-radius:16px;padding:15px;font-weight:900;
            text-transform:uppercase;letter-spacing:.12em}</style></head><body><main>
            <div class="mark">S</div><h1>You're offline</h1>
            <p>Connect to continue this SubScript web flow.</p>
            <button onclick="location.reload()">Try again</button></main></body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(PRODUCT_ORIGIN, html, "text/html", "UTF-8", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            fileChooserCallback?.onReceiveValue(result)
            fileChooserCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            val request = pendingWebPermissionRequest
            pendingWebPermissionRequest = null
            if (
                request != null &&
                grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            ) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            } else {
                request?.deny()
            }
            return
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        pendingWebPermissionRequest?.deny()
        webView.stopLoading()
        webView.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }

    private fun isTrustedUrl(value: String): Boolean {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        return uri.scheme == "https" && isProductHost(uri.host)
    }

    private fun isProductHost(host: String?): Boolean {
        val normalized = host?.lowercase() ?: return false
        return normalized == "subscriptonarc.com" ||
            normalized.endsWith(".subscriptonarc.com")
    }
}
