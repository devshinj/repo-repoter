import { useEffect, useRef } from "react";

/**
 * requestAnimationFrame 루프를 실행하며 매 프레임마다 callback(time, deltaMs)를 호출한다.
 * 컴포넌트 언마운트 시 자동 정리.
 */
export function useAnimationFrame(callback: (time: number, deltaMs: number) => void): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    const loop = (time: number) => {
      const delta = time - lastTime;
      lastTime = time;
      cbRef.current(time, delta);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
