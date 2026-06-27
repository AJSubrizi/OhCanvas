import { useCallback, useState } from "react";
import type { Annotation, DrawTool } from "./AnnotationOverlay";
import type { AnnotationEditor } from "./AnnotationOverlay";

interface UseAnnotationsOptions {
  initial?: Annotation[];
  /** Called when the user sends the current annotations to a terminal. */
  onSend?: (annotations: Annotation[]) => void;
}

/**
 * State holder for the annotation editor. Returns an `AnnotationEditor` object
 * that can be passed directly to `<AnnotationOverlay editor={...} />`.
 */
export function useAnnotations({ initial = [], onSend }: UseAnnotationsOptions = {}): AnnotationEditor {
  const [annotations, setAnnotations] = useState<Annotation[]>(initial);
  const [tool, setTool] = useState<DrawTool>(null);
  const [color, setColor] = useState("#facc15");
  const [editing, setEditing] = useState(false);
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
  const [pendingText, setPendingText] = useState<AnnotationEditor["pendingText"]>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const add = useCallback((ann: Annotation) => {
    setAnnotations((prev) => [...prev, ann]);
    setPendingText(null);
    setSelectedIndex(null);
  }, []);

  const update = useCallback((updater: (prev: Annotation[]) => Annotation[]) => {
    setAnnotations(updater);
  }, []);

  const removeAt = useCallback((index: number) => {
    setAnnotations((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex(null);
  }, []);

  const updateAnnotation = useCallback(
    (index: number, updater: (ann: Annotation) => Annotation) => {
      setAnnotations((prev) => prev.map((ann, i) => (i === index ? updater(ann) : ann)));
    },
    [],
  );

  const clear = useCallback(() => {
    setAnnotations([]);
    setPendingText(null);
    setSelectedIndex(null);
    setActiveAnnotation(null);
    setTool(null);
  }, []);

  const toggleEditing = useCallback(() => {
    setEditing((e) => {
      const next = !e;
      if (!next) {
        setTool(null);
        setPendingText(null);
        setActiveAnnotation(null);
        setSelectedIndex(null);
      }
      return next;
    });
  }, []);

  // Trigger the onSend callback. Intentionally reads annotations from state
  // via a ref-less closure: callers pass onSend so the latest value is captured.
  const send = useCallback(() => {
    if (onSend) onSend(annotations);
  }, [annotations, onSend]);

  // Expose send under a stable name for callers that want it directly.
  void send;

  return {
    annotations,
    tool,
    color,
    editing,
    activeAnnotation,
    pendingText,
    selectedIndex,
    setColor,
    setTool,
    setEditing,
    setPendingText,
    setSelectedIndex,
    setActiveAnnotation,
    add,
    update,
    removeAt,
    updateAnnotation,
    clear,
    toggleEditing,
  };
}
