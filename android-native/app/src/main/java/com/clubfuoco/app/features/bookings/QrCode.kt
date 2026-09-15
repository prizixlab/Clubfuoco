package com.clubfuoco.app.features.bookings

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import com.clubfuoco.app.core.designsystem.FuocoFixed
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * The door pass. Port of `QRCodeView`.
 *
 * Deliberately white-on-dark in BOTH appearances: scanners need the quiet zone,
 * so this must never follow the app's light/dark setting.
 */
@Composable
fun QrCode(token: String, modifier: Modifier = Modifier) {
    val bitmap: ImageBitmap? = remember(token) { encodeQr(token) }

    Box(
        modifier.background(FuocoFixed.qrSurface),
        contentAlignment = androidx.compose.ui.Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap,
                contentDescription = null,
                // NONE filtering keeps the modules crisp; smoothing a QR makes
                // it measurably harder to scan.
                filterQuality = androidx.compose.ui.graphics.FilterQuality.None,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().padding(8.dp),
            )
        }
    }
}

private fun encodeQr(token: String, size: Int = 512): ImageBitmap? = runCatching {
    val hints = mapOf(
        // The door is often dim and the phone screen smudged — high correction
        // buys a lot of real-world scan reliability for a little density.
        EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.H,
        EncodeHintType.MARGIN to 1,
    )
    val matrix = QRCodeWriter().encode(token, BarcodeFormat.QR_CODE, size, size, hints)
    val bitmap = createBitmap(matrix.width, matrix.height)
    val dark = FuocoFixed.onQrSurface.toArgb()
    val light = android.graphics.Color.WHITE
    for (x in 0 until matrix.width) {
        for (y in 0 until matrix.height) {
            bitmap.setPixel(x, y, if (matrix.get(x, y)) dark else light)
        }
    }
    bitmap.asImageBitmap()
}.getOrNull()
