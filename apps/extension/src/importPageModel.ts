import type { ImportSourceKind } from "@ourchival/parsers";
import type { StreamImportState } from "./storage";

export type ImportPageSelection<TFile = File> = {
  selectedSource: ImportSourceKind;
  generation: number;
  selectedFile?: TFile;
  activeState?: StreamImportState;
};

export function transitionImportSource<TFile>(
  selectedSource: ImportSourceKind,
  currentGeneration: number,
): ImportPageSelection<TFile> {
  return { selectedSource, generation: currentGeneration + 1 };
}

export type ImportIdentificationTicket<TFile = File> = {
  generation: number;
  source: ImportSourceKind;
  file: TFile;
};

export function createImportIdentificationTicket<TFile>(
  generation: number,
  source: ImportSourceKind,
  file: TFile,
): ImportIdentificationTicket<TFile> {
  return { generation, source, file };
}

export function isCurrentImportIdentification<TFile>(
  ticket: ImportIdentificationTicket<TFile>,
  generation: number,
  source: ImportSourceKind,
  file: TFile | undefined,
) {
  return (
    ticket.generation === generation &&
    ticket.source === source &&
    ticket.file === file
  );
}

export function canChangeImportSource(state: StreamImportState | undefined) {
  return state?.status !== "running";
}

export function canRetryStreamImport(
  state: StreamImportState | undefined,
  fileSelected: boolean,
) {
  return Boolean(
    fileSelected &&
    state?.status === "error" &&
    state.retryable === true &&
    state.sessionKey &&
    state.parserVersion &&
    state.importDigest &&
    state.expectedCount > 0 &&
    state.sessionKey ===
      `${state.source}:${state.parserVersion}:${state.importDigest}`,
  );
}

export function importPageActions(
  state: StreamImportState | undefined,
  fileSelected: boolean,
): Array<{
  id: "start" | "pause" | "another";
  label: string;
  className?: "secondary";
}> {
  if (fileSelected && state?.status === "ready")
    return [{ id: "start", label: "Start import" }];
  if (fileSelected && state?.status === "paused")
    return [{ id: "start", label: "Continue import" }];
  if (canRetryStreamImport(state, fileSelected))
    return [{ id: "start", label: "Retry from checkpoint" }];
  if (state?.status === "running")
    return [
      {
        id: "pause",
        label: "Pause after this batch",
        className: "secondary",
      },
    ];
  if (state?.status === "completed")
    return [
      { id: "another", label: "Import another file", className: "secondary" },
    ];
  return [];
}
