"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";
import { X, Camera, Upload, AlertCircle, RefreshCw } from "@/components/icons";

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedText: string) => void;
  title?: string;
}

export default function QrScannerModal({
  isOpen,
  onClose,
  onScan,
  title = "Scan Recipient QR Code",
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [stream, setStream] = useState<MediaStream | null>(null);

  const parseScannedData = (raw: string): string => {
    let result = raw.trim();
    // EIP-681 ethereum:0x... parsing
    if (result.toLowerCase().startsWith("ethereum:")) {
      result = result.replace(/^ethereum:/i, "").split("?")[0].split("/")[0];
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

  const stopCamera = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setCameraActive(false);
  }, [stream]);

  const startCamera = useCallback(async (facing: "environment" | "user" = "environment") => {
    stopCamera();
    setErrorMsg(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API is not supported on this browser or context.");
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
      });

      setStream(mediaStream);
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.setAttribute("playsinline", "true"); // required for iOS Safari
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.warn("Camera access failed:", err);
      setErrorMsg(
        err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
          ? "Camera permission denied. You can upload an image containing a QR code below."
          : err?.message || "Unable to access camera. Use image upload fallback below."
      );
      setCameraActive(false);
    }
  }, [stopCamera]);

  // Continuously scan video frames
  useEffect(() => {
    if (!cameraActive || !isOpen) return;

    const canvas = canvasRef.current || document.createElement("canvas");
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scanFrame = () => {
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          const parsed = parseScannedData(code.data);
          if (parsed) {
            onScan(parsed);
            stopCamera();
            onClose();
            return;
          }
        }
      }
      animFrameIdRef.current = requestAnimationFrame(scanFrame);
    };

    animFrameIdRef.current = requestAnimationFrame(scanFrame);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [cameraActive, isOpen, onClose, onScan, stopCamera]);

  useEffect(() => {
    if (isOpen) {
      startCamera(cameraFacing);
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          const parsed = parseScannedData(code.data);
          onScan(parsed);
          onClose();
        } else {
          setErrorMsg("Could not detect a valid QR code in the uploaded image.");
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const toggleCameraFacing = () => {
    const nextFacing = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(nextFacing);
    startCamera(nextFacing);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#0d0d12] p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[#ccff00]/10 text-[#ccff00] border border-[#ccff00]/20">
              <Camera className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-[0.14em] text-white">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-2 text-white/50 hover:text-white bg-white/5 border border-white/10 rounded-full transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video Viewport / Reticle */}
        <div className="relative w-full aspect-square bg-black rounded-2xl border border-white/10 overflow-hidden flex items-center justify-center">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
          />

          {/* Scanner Reticle Overlay */}
          {cameraActive && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-48 h-48 border-2 border-[#ccff00] rounded-2xl relative shadow-[0_0_30px_rgba(204,255,0,0.3)]">
                {/* Reticle corner accents */}
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-[#ccff00] rounded-tl-lg" />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-[#ccff00] rounded-tr-lg" />
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-[#ccff00] rounded-bl-lg" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-[#ccff00] rounded-br-lg" />
                
                {/* Laser scan line animation */}
                <div className="absolute inset-x-0 h-0.5 bg-[#ccff00] shadow-[0_0_15px_#ccff00] animate-pulse top-1/2 -translate-y-1/2" />
              </div>
            </div>
          )}

          {!cameraActive && !errorMsg && (
            <div className="flex flex-col items-center gap-2 text-white/40">
              <Camera className="w-8 h-8 animate-pulse" />
              <span className="text-[10px] uppercase font-bold tracking-wider">Starting camera...</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 text-center space-y-2">
              <AlertCircle className="w-6 h-6 text-amber-400 mx-auto" />
              <p className="text-xs text-amber-200/90 leading-relaxed">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-3">
          {cameraActive && (
            <button
              type="button"
              onClick={toggleCameraFacing}
              className="w-full py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-wider text-white/80 flex items-center justify-center gap-2 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Switch Camera ({cameraFacing})
            </button>
          )}

          {/* Upload Fallback */}
          <label className="w-full py-3 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 border border-[#ccff00]/30 rounded-2xl text-xs font-black uppercase tracking-[0.14em] text-white flex items-center justify-center gap-2 cursor-pointer transition shadow-[0_0_15px_rgba(204,255,0,0.1)]">
            <Upload className="w-4 h-4 text-[#ccff00]" />
            Upload QR Image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
