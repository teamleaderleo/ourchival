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
  if (!state || state.status === "completed") return true;
  return (
    state.checkpointOrdinal < 0 &&
    (state.status === "ready" || state.status === "error")
  );
}

export function canSelectImportFile(state: StreamImportState | undefined) {
  return state?.status !== "running";
}

export function recoverInterruptedImportState(
  state: StreamImportState | undefined,
) {
  if (!state || state.status !== "running") return state;
  return {
    ...state,
    status: "paused" as const,
    retryable: undefined,
    message:
      "Import was interrupted. Select the same file to reconcile the durable checkpoint.",
  };
}

export function shouldPreservePendingImport(
  state: StreamImportState | undefined,
  nextSessionKey: string,
) {
  return Boolean(
    state &&
    state.sessionKey !== nextSessionKey &&
    state.status !== "completed" &&
    state.checkpointOrdinal >= 0,
  );
}

export function importRequestFailureMessage(
  message: string,
  retryable: boolean,
) {
  if (!retryable || /progress is preserved/i.test(message)) return message;
  return `${message} Progress is preserved; retry from the saved checkpoint.`;
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
