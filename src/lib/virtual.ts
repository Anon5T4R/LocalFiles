import { useEffect, useState, type RefObject } from "react";

/**
 * Virtualização por janela (sem lib): dado o nº de linhas e a altura fixa da
 * linha, devolve o intervalo visível + paddings pra ocupar o espaço total.
 * Funciona pra lista (1 item = 1 linha) e grade (1 linha = N cards).
 */

export interface VirtualRange {
  start: number;
  end: number; // exclusivo
  padTop: number;
  padBottom: number;
}

const OVERSCAN = 8;

export function useVirtual(
  ref: RefObject<HTMLElement | null>,
  rowCount: number,
  rowHeight: number,
  headerHeight = 0,
): VirtualRange {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
    // rowCount na dependência: pasta nova zera o scroll e o el é o mesmo.
  }, [ref, rowCount]);

  const usable = Math.max(0, scrollTop - headerHeight);
  const start = Math.max(0, Math.floor(usable / rowHeight) - OVERSCAN);
  const visible = Math.ceil(viewport / rowHeight) + OVERSCAN * 2;
  const end = Math.min(rowCount, start + visible);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (rowCount - end) * rowHeight),
  };
}

/** Largura observada de um container (colunas da grade). */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
