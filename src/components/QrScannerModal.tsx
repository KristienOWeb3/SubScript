"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";
import { X, QrCode, AlertCircle } from "@/components/icons";

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedText: string) => void;
  title?: string;
}

export function QrScannerModal({
  isOpen,
  onClose,
  onScan,
  title = "Scan Recipient QR Code",
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parseScannedData = (raw: string): string => {
    let result = raw.trim();
    // EIP-681 ethereum:0x... parsing
    if (result.toLowerCase().startsWith("ethereum:")) {
      result = result.replace(/^ethereum:/i, "").split("?")[0].split("/")[0].split("@")[0];
    }
    // URL format https://.../pay?address=0x...
    if (result.includes("address=")) {
      try {
        const url = new URL(result);
        const addr = url.searchParams.get("address");
        if (addr) result = addr;
      } catch {
        // keep raw
      }
    }
    return result;
  };

  const triggerHaptic = () => {
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([40, 30, 40]);
      }
    } catch {
      // Haptics unavailable
    }
  };

  const stopCamera = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setErrorMsg(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Mobile camera API is not supported on this browser context.");
      }

      let mediaStream: MediaStream;
      try {
        // Phones: default strictly to rear/back camera (environment facingMode)
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        // Fallback for devices without a designated rear camera (e.g. desktop webcams)
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = mediaStream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.setAttribute("playsinline", "true"); // Mobile iOS Safari native inline video
        videoRef.current.setAttribute("autoplay", "true");
        videoRef.current.setAttribute("muted", "true");
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.warn("Mobile camera initialization error:", err);
      setErrorMsg(
        err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
          ? "Camera permission denied. Allow camera access in site settings to scan QR codes."
          : "Camera unavailable on this device."
      );
      setCameraActive(false);
    }
  }, [stopCamera]);

  const handleScanSuccess = useCallback(
    (rawResult: string) => {
      const parsed = parseScannedData(rawResult);
      if (parsed) {
        triggerHaptic();
        stopCamera();
        onScan(parsed);
        onClose();
      }
    },
    [onScan, onClose, stopCamera]
  );

  // Scan frame loop using BarcodeDetector (native OS hardware engine) or jsQR fallback
  useEffect(() => {
    if (!cameraActive || !isOpen) return;

    let active = true;
    let barcodeDetector: any = null;

    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      try {
        barcodeDetector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        barcodeDetector = null;
      }
    }

    const canvas = canvasRef.current || document.createElement("canvas");
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scanFrame = async () => {
      if (!active) return;
      const video = videoRef.current;

      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        // Option A: Mobile Native BarcodeDetector API (iOS Safari 17+ / Android Chrome hardware scanner)
        if (barcodeDetector) {
          try {
            const barcodes = await barcodeDetector.detect(video);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              handleScanSuccess(barcodes[0].rawValue);
              return;
            }
          } catch {
            // Fall back to canvas + jsQR below
          }
        }

        // Option B: Canvas + jsQR fallback
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code && code.data) {
            handleScanSuccess(code.data);
            return;
          }
        }
      }

      animFrameIdRef.current = requestAnimationFrame(scanFrame);
    };

    animFrameIdRef.current = requestAnimationFrame(scanFrame);

    return () => {
      active = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [cameraActive, isOpen, handleScanSuccess]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-[#0d0e11] p-5 sm:p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2 text-white">
            <QrCode className="h-5 w-5 text-[#ccff00]" />
            <h3 className="text-sm font-black uppercase tracking-wider">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Viewfinder Viewport */}
        <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-black/80 flex items-center justify-center">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            autoPlay
            muted
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Mobile Native Camera Viewfinder Box */}
          {cameraActive && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-48 w-48 rounded-3xl border-2 border-[#ccff00] shadow-[0_0_30px_rgba(204,255,0,0.35)]">
                <div className="absolute top-0 left-0 h-4 w-4 border-t-4 border-l-4 border-[#ccff00] rounded-tl-lg" />
                <div className="absolute top-0 right-0 h-4 w-4 border-t-4 border-r-4 border-[#ccff00] rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 h-4 w-4 border-b-4 border-l-4 border-[#ccff00] rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 h-4 w-4 border-b-4 border-r-4 border-[#ccff00] rounded-br-lg" />
                <div className="h-full w-full animate-pulse bg-[#ccff00]/5 rounded-3xl" />
              </div>
            </div>
          )}

          {/* Camera Error / Fallback State */}
          {errorMsg && (
            <div className="p-6 text-center space-y-3">
              <AlertCircle className="mx-auto h-10 w-10 text-orange-400" />
              <p className="text-xs text-white/70 leading-relaxed">{errorMsg}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default QrScannerModal;
