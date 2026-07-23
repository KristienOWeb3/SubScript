"use client";

import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, Upload, X, QrCode } from "@/components/icons";

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
  title = "Scan QR Code",
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const extractAddress = (raw: string): string => {
    let clean = raw.trim();
    if (clean.toLowerCase().startsWith("ethereum:")) {
      clean = clean.substring(9).split("?")[0].split("@")[0];
    }
    return clean;
  };

  const stopCamera = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCameraError(null);
      return;
    }

    let active = true;

    async function startCamera() {
      try {
        setCameraError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
          setIsScanning(true);
          scanFrame();
        }
      } catch (err: any) {
        console.warn("Camera access failed or unavailable:", err);
        setCameraError("Camera unavailable. Upload a QR image instead.");
      }
    }

    startCamera();

    return () => {
      active = false;
      stopCamera();
    };
  }, [isOpen]);

  const scanFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (ctx) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });

      if (code && code.data) {
        const address = extractAddress(code.data);
        if (address) {
          stopCamera();
          onScan(address);
          onClose();
          return;
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(scanFrame);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            const address = extractAddress(code.data);
            if (address) {
              onScan(address);
              onClose();
              return;
            }
          }
          alert("No valid QR code found in the uploaded image.");
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-[#121316] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2 text-white">
            <QrCode className="h-5 w-5 text-[#ccff00]" />
            <h3 className="text-sm font-black uppercase tracking-wider">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Camera / Viewport */}
        <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-black/60 flex items-center justify-center">
          <video ref={videoRef} className="h-full w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />

          {/* Scanner Overlay Box */}
          {isScanning && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-2xl border-2 border-[#ccff00] shadow-[0_0_25px_rgba(204,255,0,0.3)] animate-pulse" />
            </div>
          )}

          {cameraError && (
            <div className="p-4 text-center">
              <Camera className="mx-auto h-8 w-8 text-white/30 mb-2" />
              <p className="text-xs text-white/60">{cameraError}</p>
            </div>
          )}
        </div>

        {/* Upload Fallback Button */}
        <div className="mt-4 flex flex-col gap-2">
          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10">
            <Upload className="h-4 w-4 text-[#ccff00]" />
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
