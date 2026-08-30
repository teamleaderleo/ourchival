"use client";

import { useEffect, useRef, useState } from "react";

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (args: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (
        element: HTMLElement,
        options: {
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "large" | "medium" | "small";
          shape?: "rectangular" | "pill" | "circle" | "square";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          width?: number;
        },
      ) => void;
    };
  };
};

const scriptId = "ourchival-google-identity";

export function GoogleOwnerSignIn({
  onCredential,
  disabled = false,
}: {
  onCredential: (credential: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!clientId || disabled) return;
    const configuredClientId = clientId;
    let cancelled = false;

    async function setup() {
      try {
        await loadGoogleIdentityScript();
        if (cancelled || !mountRef.current) return;
        const google = getGoogleIdentity();
        if (!google) throw new Error("Google Identity Services did not initialize.");

        mountRef.current.replaceChildren();
        google.accounts.id.initialize({
          client_id: configuredClientId,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (response) => {
            const credential = response.credential?.trim();
            if (!credential) {
              setMessage("Google sign-in did not return a credential.");
              return;
            }
            setMessage("");
            void onCredential(credential);
          },
        });
        google.accounts.id.renderButton(mountRef.current, {
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text: "continue_with",
          width: Math.min(360, Math.max(240, mountRef.current.clientWidth || 320)),
        });
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Google sign-in is unavailable.");
        }
      }
    }

    void setup();
    return () => {
      cancelled = true;
    };
  }, [clientId, disabled, onCredential]);

  if (!clientId) return null;

  return (
    <div className="google-owner-signin">
      <div ref={mountRef} aria-busy={disabled} />
      {message ? <p className="access-message">{message}</p> : null}
    </div>
  );
}

function getGoogleIdentity() {
  const windowWithGoogle = window as unknown as { google?: GoogleIdentity };
  return windowWithGoogle.google;
}

function loadGoogleIdentityScript() {
  if (getGoogleIdentity()) return Promise.resolve();

  const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      if (getGoogleIdentity()) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google sign-in.")), {
        once: true,
      });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google sign-in."));
    document.head.appendChild(script);
  });
}
