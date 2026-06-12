"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { LogoConceptA } from "@/components/ui/sympol";

const glitchChars = "!@#$%^&*()_+-=[]{}|;:,.<>?/~`01";

function getRandomChar() {
  return glitchChars[Math.floor(Math.random() * glitchChars.length)];
}

export function Logo({ asLink = true }: { asLink?: boolean }) {
  const text = "AutoBriify";
  const [displayText, setDisplayText] = useState("");
  const [isTyped, setIsTyped] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);
  const [glitchText, setGlitchText] = useState(text);
  const [showCursor, setShowCursor] = useState(true);

  // ref로 진행 상태 유지 (Strict Mode 이중 마운트 대응)
  const typeIndexRef = useRef(0);
  const glitchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 초기 타이핑 애니메이션
  useEffect(() => {
    if (typeIndexRef.current > text.length) {
      setDisplayText(text);
      setIsTyped(true);
      return;
    }

    const interval = setInterval(() => {
      if (typeIndexRef.current <= text.length) {
        setDisplayText(text.slice(0, typeIndexRef.current));
        typeIndexRef.current++;
      } else {
        clearInterval(interval);
        setIsTyped(true);
      }
    }, 80);

    return () => clearInterval(interval);
  }, []);

  // 커서 깜빡임
  useEffect(() => {
    if (!isTyped) return;
    const interval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(interval);
  }, [isTyped]);

  // 글리치 interval 정리
  useEffect(() => {
    return () => {
      if (glitchIntervalRef.current) {
        clearInterval(glitchIntervalRef.current);
      }
    };
  }, []);

  // 호버 글리치
  const triggerGlitch = useCallback(() => {
    if (isGlitching || !isTyped) return;
    setIsGlitching(true);

    let iterations = 0;
    const maxIterations = 8;

    glitchIntervalRef.current = setInterval(() => {
      setGlitchText(
        text
          .split("")
          .map((char, idx) => {
            if (char === " ") return " ";
            if (idx < Math.floor((iterations / maxIterations) * text.length)) {
              return text[idx];
            }
            return getRandomChar();
          })
          .join("")
      );

      iterations++;

      if (iterations > maxIterations) {
        clearInterval(glitchIntervalRef.current!);
        glitchIntervalRef.current = null;
        setGlitchText(text);
        setIsGlitching(false);
      }
    }, 40);
  }, [isGlitching, isTyped]);

  const renderedText = isGlitching ? glitchText : isTyped ? text : displayText;

  const content = (
    <div
      className="group relative select-none"
      onMouseEnter={triggerGlitch}
    >
      {/* 심볼 + 텍스트 가로 배치 */}
      <div className="flex items-center gap-2.5">
        <LogoConceptA className="w-8 h-8 shrink-0" />
        {/* 메인 텍스트 */}
        <div className="relative flex items-baseline gap-0">
          <span className="font-mono text-[15px] font-semibold tracking-tight text-foreground transition-colors duration-200">
            <span className="text-muted-foreground/60 font-normal mr-0.5">{">"}</span>
            <span className="relative">
              {renderedText}
              {/* 글리치 시 RGB 분리 효과 */}
              {isGlitching && (
                <>
                  <span
                    className="absolute inset-0 text-[15px] font-mono font-semibold tracking-tight opacity-60 mix-blend-multiply"
                    style={{
                      color: "oklch(0.65 0.15 25)",
                      clipPath: "inset(10% 0 60% 0)",
                      transform: "translateX(-1.5px)",
                    }}
                    aria-hidden
                  >
                    {glitchText}
                  </span>
                  <span
                    className="absolute inset-0 text-[15px] font-mono font-semibold tracking-tight opacity-60 mix-blend-multiply"
                    style={{
                      color: "oklch(0.65 0.15 250)",
                      clipPath: "inset(50% 0 10% 0)",
                      transform: "translateX(1.5px)",
                    }}
                    aria-hidden
                  >
                    {glitchText}
                  </span>
                </>
              )}
            </span>
          </span>
          {/* 블링킹 커서 */}
          <span
            className="inline-block w-[7px] h-[15px] ml-[1px] bg-foreground/80 translate-y-[1px] transition-opacity duration-100"
            style={{ opacity: !isTyped || showCursor ? 1 : 0 }}
            aria-hidden
          />
        </div>
      </div>

      {/* 하단 스캔라인 언더라인 */}
      <div className="mt-1 h-[1px] w-full overflow-hidden">
        <div
          className="h-full bg-foreground/20 origin-left transition-transform duration-300 ease-out scale-x-0 group-hover:scale-x-100"
        />
      </div>

      {/* 호버 시 서브텍스트 */}
      <div className="overflow-hidden h-0 group-hover:h-4 transition-all duration-300 ease-out">
        <p className="font-mono text-[10px] text-muted-foreground/50 tracking-widest uppercase mt-0.5">
          auto brief, simplified
        </p>
      </div>
    </div>
  );

  if (asLink) {
    return (
      <Link href="/" className="block no-underline hover:no-underline">
        {content}
      </Link>
    );
  }

  return content;
}
