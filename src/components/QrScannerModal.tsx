"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";
import { X, QrCode, AlertCircle, Zap, RotateCw, Check, Copy } from "@/components/icons";

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Receives the scan exactly as it was decoded, with nothing stripped.
   *
   * This used to hand over a pre-extracted address, which meant the scanner decided what a code
   * "was" before the caller could look at it — so a DM invite arrived at a recipient field as a URL,
   * and a `/commit/0x…` link arrived as a bare address with the link thrown away. Callers now say
   * what they want with `parseScannedAddress` or `resolveScannedTarget` from `@/lib/qr/scanTargets`.
   */
  onScan: (scannedText: string) => void;
  title?: string;
}

/* Identifies permission denial errors vs recoverable device/constraint errors */
const isPermissionError = (err: unknown): boolean => {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError";
};

/* Scores video devices to prioritize the 1x standard/main rear camera over 0.5x ultra-wide */
function scoreCameraDevice(device: MediaDeviceInfo): number {
  const label = (device.label || "").toLowerCase();

  const isFront =
    label.includes("front") ||
    label.includes("user") ||
    label.includes("selfie") ||
    label.includes("facing front") ||
    label.includes("1, facing front");

  if (isFront) return -100;

  const isUltraWide =
    label.includes("ultra") ||
    label.includes("0.5") ||
    label.includes("wide-angle") ||
    label.includes("wide angle") ||
    label.includes("macro") ||
    label.includes("depth");

  const isTelephoto =
    label.includes("telephoto") ||
    label.includes("tele") ||
    label.includes("zoom") ||
    label.includes("2x") ||
    label.includes("3x") ||
    label.includes("5x") ||
    label.includes("10x");

  const isExplicit1x =
    label.includes("1x") ||
    label.includes("main") ||
    label.includes("primary") ||
    label.includes("standard") ||
    label.includes("camera2 0") ||
    label.includes("camera 0");

  const isWideOnly = (label.includes("wide") && !label.includes("ultra")) || label.includes("back");

  if (isUltraWide) return -50;
  if (isTelephoto) return -20;
  if (isExplicit1x) return 100;
  if (isWideOnly) return 80;
  return 10;
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
  const [successScanned, setSuccessScanned] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState<number>(0);
  const [clipboardBusy, setClipboardBusy] = useState(false);

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
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const [track] = streamRef.current.getVideoTracks();
    if (!track) return;

    try {
      const nextState = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
    } catch (e) {
      console.warn("Could not toggle torch:", e);
    }
  };

  const switchCamera = () => {
    if (availableCameras.length <= 1) return;
    const nextIdx = (cameraIndex + 1) % availableCameras.length;
    setCameraIndex(nextIdx);
  };

  const startCamera = useCallback(async () => {
    stopCamera();
    setErrorMsg(null);
    setSuccessScanned(false);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Mobile camera API is not supported on this browser context.");
      }

      // Enumerate devices to prioritize 1x main camera
      let videoDevices: MediaDeviceInfo[] = [];
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter((d) => d.kind === "videoinput");
        // Sort with 1x main camera first
        videoDevices.sort((a, b) => scoreCameraDevice(b) - scoreCameraDevice(a));
        setAvailableCameras(videoDevices);
      } catch {
        // Enumerate not permitted before initial prompt
      }

      let mediaStream: MediaStream | null = null;
      const targetDevice = videoDevices[cameraIndex];

      // 1. Try with chosen 1x main deviceId if available
      if (targetDevice?.deviceId) {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: targetDevice.deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          // DeviceId exact match failed; proceed to facingMode strategy
        }
      }

      // 2. Strict 1x main back camera constraint with 1080p bias
      if (!mediaStream) {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch (rearError: any) {
          if (isPermissionError(rearError)) throw rearError;
          // Fallback to standard environment or any camera
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment" },
              audio: false,
            });
          } catch (relaxedError: any) {
            if (isPermissionError(relaxedError)) throw relaxedError;
            mediaStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
        }
      }

      if (!mediaStream) {
        throw new Error("Could not initialize video stream.");
      }

      // 3. Post-stream configuration: enforce 1x zoom & continuous focus
      const [videoTrack] = mediaStream.getVideoTracks();
      if (videoTrack) {
        try {
          const capabilities = (videoTrack.getCapabilities ? videoTrack.getCapabilities() : {}) as any;
          const advancedConstraints: any = {};

          // If device supports zoom (e.g. multi-lens sensor that started on 0.5x), force 1x magnification
          if (capabilities.zoom) {
            const minZoom = capabilities.zoom.min || 1;
            const maxZoom = capabilities.zoom.max || 1;
            if (minZoom <= 1 && maxZoom >= 1) {
              advancedConstraints.zoom = 1.0;
            } else if (minZoom > 1) {
              advancedConstraints.zoom = minZoom;
            }
          }

          // Request continuous auto focus for sharp QR acquisition
          if (capabilities.focusMode && Array.isArray(capabilities.focusMode)) {
            if (capabilities.focusMode.includes("continuous")) {
              advancedConstraints.focusMode = "continuous";
            } else if (capabilities.focusMode.includes("auto")) {
              advancedConstraints.focusMode = "auto";
            }
          }

          if (capabilities.torch) {
            setTorchSupported(true);
          }

          if (Object.keys(advancedConstraints).length > 0) {
            await (videoTrack as any).applyConstraints({ advanced: [advancedConstraints] }).catch(() => {});
          }
        } catch (e) {
          console.warn("Could not apply 1x lens constraints:", e);
        }
      }

      streamRef.current = mediaStream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("autoplay", "true");
        videoRef.current.setAttribute("muted", "true");
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.warn("Mobile camera initialization error:", err);
      setErrorMsg(
        isPermissionError(err)
          ? "Camera permission denied. Allow camera access in site settings to scan QR codes."
          : "Camera unavailable on this device."
      );
      setCameraActive(false);
    }
  }, [stopCamera, cameraIndex]);

  const handleScanSuccess = useCallback(
    (rawResult: string) => {
      const scanned = (rawResult || "").trim();
      if (scanned) {
        setSuccessScanned(true);
        triggerHaptic();
        setTimeout(() => {
          stopCamera();
          onScan(scanned);
          onClose();
        }, 220);
      }
    },
    [onScan, onClose, stopCamera]
  );

  const handlePasteFromClipboard = async () => {
    setClipboardBusy(true);
    try {
      const text = await navigator.clipboard.readText();
      const pasted = (text || "").trim();
      /* An address, a SubScript link, or a handle are all legitimate here — the caller decides what
         it will accept, so this only rejects an empty clipboard. */
      if (pasted) {
        handleScanSuccess(pasted);
        return;
      }
      setErrorMsg("Your clipboard is empty.");
    } catch {
      setErrorMsg("Clipboard access was not granted.");
    } finally {
      setClipboardBusy(false);
    }
  };

  // Scan frame loop using BarcodeDetector (hardware accelerated) or jsQR fallback
  useEffect(() => {
    if (!cameraActive || !isOpen || successScanned) return;

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
      if (!active || successScanned) return;
      const video = videoRef.current;

      if (video && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        // Option A: Hardware BarcodeDetector API (iOS Safari 17+ / Chrome Android)
        if (barcodeDetector) {
          try {
            const barcodes = await barcodeDetector.detect(video);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              handleScanSuccess(barcodes[0].rawValue);
              return;
            }
          } catch {
            // Fall back to jsQR below
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
  }, [cameraActive, isOpen, successScanned, handleScanSuccess]);

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
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-2xl p-4 sm:p-6 animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/15 bg-[#0e1217]/95 p-5 sm:p-6 text-white shadow-2xl">
        {/* Ambient Top Glow */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#2775ca]/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 -bottom-16 h-40 w-40 rounded-full bg-[#2775ca]/15 blur-3xl" />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#2775ca]/20 border border-[#2775ca]/40 text-[#2775ca]">
              <QrCode className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white">{title}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] font-bold text-white/60">1x Main Camera Active</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Flashlight Toggle */}
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                title={torchOn ? "Turn Torch Off" : "Turn Torch On"}
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                  torchOn
                    ? "border-amber-400 bg-amber-400/20 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.5)]"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Camera Switch Button */}
            {availableCameras.length > 1 && (
              <button
                type="button"
                onClick={switchCamera}
                title="Switch Camera Lens"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 hover:bg-white/15 hover:text-white transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Viewfinder Viewport */}
        <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-2xl border border-white/15 bg-black flex items-center justify-center shadow-inner">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            autoPlay
            muted
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Viewfinder Box & Corner Brackets */}
          {cameraActive && !errorMsg && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`relative h-52 w-52 rounded-3xl border-2 transition-all duration-300 ${
                  successScanned
                    ? "border-emerald-400 shadow-[0_0_35px_rgba(52,211,153,0.8)] bg-emerald-400/20 scale-105"
                    : "border-[#2775ca]/90 shadow-[0_0_30px_rgba(39,117,202,0.4)]"
                }`}
              >
                {/* Precision Corner Brackets */}
                <div className="absolute -top-1 -left-1 h-5 w-5 border-t-4 border-l-4 border-[#2775ca] rounded-tl-xl" />
                <div className="absolute -top-1 -right-1 h-5 w-5 border-t-4 border-r-4 border-[#2775ca] rounded-tr-xl" />
                <div className="absolute -bottom-1 -left-1 h-5 w-5 border-b-4 border-l-4 border-[#2775ca] rounded-bl-xl" />
                <div className="absolute -bottom-1 -right-1 h-5 w-5 border-b-4 border-r-4 border-[#2775ca] rounded-br-xl" />

                {/* Animated Vertical Laser Sweep */}
                {!successScanned && (
                  <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-[#2775ca] to-transparent shadow-[0_0_10px_#2775ca] animate-[scannerSweep_2.2s_ease-in-out_infinite]" />
                )}

                {/* Success Feedback Icon */}
                {successScanned && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xl animate-in zoom-in-50 duration-200">
                      <Check className="h-8 w-8 stroke-[3]" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Camera Error / Permission Blocked State */}
          {errorMsg && (
            <div className="p-6 text-center space-y-3 z-10">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-400">
                <AlertCircle className="h-6 w-6" />
              </div>
              <p className="text-xs text-white/75 leading-relaxed">{errorMsg}</p>
              <button
                type="button"
                onClick={startCamera}
                className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Retry Camera
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="relative z-10 mt-4 space-y-2.5">
          <p className="text-center text-[11px] text-white/60">
            Line the QR code up inside the frame.
          </p>

          <button
            type="button"
            onClick={handlePasteFromClipboard}
            disabled={clipboardBusy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-white/90 hover:bg-white/10 hover:text-white transition shadow-sm"
          >
            <Copy className="h-3.5 w-3.5 text-[#2775ca]" />
            {clipboardBusy ? "Reading clipboard..." : "Paste from clipboard"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default QrScannerModal;
