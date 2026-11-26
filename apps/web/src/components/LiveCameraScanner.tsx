"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LiveCameraScannerProps = {
  busy: boolean;
  paused: boolean;
  onCapture: (file: File) => Promise<void>;
  onAnnounce: (message: string, speak?: boolean) => void;
};

type FrameQuality = {
  ok: boolean;
  warning: string | null;
};

function assessFrameQuality(ctx: CanvasRenderingContext2D, width: number, height: number): FrameQuality {
  const sampleW = 160;
  const sampleH = Math.max(90, Math.round((height / Math.max(1, width)) * sampleW));
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sampleW;
  tempCanvas.height = sampleH;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return { ok: true, warning: null };

  tempCtx.drawImage(ctx.canvas, 0, 0, sampleW, sampleH);
  const { data } = tempCtx.getImageData(0, 0, sampleW, sampleH);

  let sumLum = 0;
  let sumEdge = 0;
  const pixelCount = sampleW * sampleH;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sumLum += lum;
    if (i >= 4) {
      const prevLum = 0.299 * data[i - 4] + 0.587 * data[i - 3] + 0.114 * data[i - 2];
      sumEdge += Math.abs(lum - prevLum);
    }
  }

  const avgLum = sumLum / pixelCount;
  const avgEdge = sumEdge / pixelCount;

  if (avgLum < 12) {
    return { ok: false, warning: "Camera frame is pitch dark. Check camera cover or lighting." };
  }
  if (avgLum > 248) {
    return { ok: false, warning: "Too much glare. Tilt the note slightly and try again." };
  }
  if (avgEdge < 1.0) {
    return { ok: false, warning: "Frame looks blank. Hold one Naira note in front of the webcam." };
  }
  return { ok: true, warning: null };
}

export function LiveCameraScanner({ busy, paused, onCapture, onAnnounce }: LiveCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setAutoScan(false);
    setScanFeedback(null);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Attach the MediaStream once the <video> element mounts when cameraActive becomes true.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraActive || !video || !stream) return;

    video.srcObject = stream;
    void video.play().catch(() => {
      setCameraError("Unable to start video playback. Try tapping Scan note now or use photo upload.");
    });
  }, [cameraActive]);

  async function startCamera() {
    setCameraError(null);
    setScanFeedback(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const msg = "Live camera is not supported in this browser. Use the photo upload below.";
      setCameraError(msg);
      onAnnounce(msg, true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      onAnnounce("Live camera started. Place one Naira note in view and press Scan note now.", true);
    } catch {
      const msg = "Camera permission was denied or no camera was found. You can still upload a photo below.";
      setCameraError(msg);
      onAnnounce(msg, true);
    }
  }

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraActive || busy) {
      return;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      const msg = "Camera video is still starting. Wait one second and try again.";
      setScanFeedback(msg);
      onAnnounce(msg, true);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setSnapshotUrl(canvas.toDataURL("image/jpeg", 0.85));

    const quality = assessFrameQuality(ctx, canvas.width, canvas.height);
    if (!quality.ok && quality.warning) {
      setScanFeedback(quality.warning);
      onAnnounce(quality.warning, true);
      return;
    }

    setScanFeedback("Snapshot captured. Identifying note…");
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) {
      setScanFeedback("Could not capture image from camera.");
      return;
    }

    try {
      const file = new File([blob], `naira-live-${Date.now()}.jpg`, { type: "image/jpeg" });
      await onCapture(file);
      setScanFeedback("Snapshot sent for identification. See the suggestion below.");
    } catch (err) {
      setScanFeedback(err instanceof Error ? err.message : "Failed to identify snapshot.");
    }
  }, [busy, cameraActive, onAnnounce, onCapture]);

  useEffect(() => {
    if (!cameraActive || !autoScan || busy || paused) return;
    const timer = window.setInterval(() => {
      void captureFrame();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [autoScan, busy, cameraActive, captureFrame, paused]);

  return (
    <div className="camera-box">
      <div className="actions">
        {!cameraActive ? (
          <button type="button" className="primary" onClick={startCamera}>
            Start live camera
          </button>
        ) : (
          <>
            <button type="button" className="primary" onClick={() => void captureFrame()} disabled={busy}>
              {busy ? "Scanning…" : "Scan note now"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                stopCamera();
                onAnnounce("Live camera stopped.", false);
              }}
            >
              Stop camera
            </button>
          </>
        )}
      </div>

      {cameraActive && (
        <div className="camera-stage">
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
            aria-label="Live camera viewfinder for scanning a Naira banknote"
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autoScan}
              onChange={(e) => {
                const next = e.target.checked;
                setAutoScan(next);
                onAnnounce(
                  next
                    ? "Auto-scan enabled. Hold one note steady in front of the camera."
                    : "Auto-scan paused.",
                  true,
                );
              }}
            />
            <span>Auto-scan every 3 seconds (hands-free)</span>
          </label>
        </div>
      )}

      {snapshotUrl && (
        <div className="snapshot-preview">
          <p className="hint">Latest captured webcam snapshot:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={snapshotUrl}
            alt="Latest webcam snapshot of Naira note"
            className="snapshot-img"
          />
        </div>
      )}

      {scanFeedback && (
        <p className="hint" aria-live="polite">
          {scanFeedback}
        </p>
      )}

      {cameraError && (
        <p className="prototype-warning" role="alert">
          {cameraError}
        </p>
      )}
    </div>
  );
}
