"use client";

import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export type ProjectStatus = "active" | "paused" | "finished" | "archived";

export type ReferenceProject = {
  _id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  referenceCount: number;
};

export type ProjectReferenceUse = {
  _id: string;
  projectId: string;
  referenceId: string;
  assetId?: string;
  reason?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  project: ReferenceProject;
};

type CreateProjectArgs = {
  name: string;
  description?: string;
  status?: ProjectStatus;
};
type UpdateProjectArgs = {
  projectId: string;
  name: string;
  description?: string;
  status: ProjectStatus;
};
type ProjectIdArgs = { projectId: string };
type ReferenceIdArgs = { referenceId: string };
type UpsertReferenceArgs = {
  projectId: string;
  referenceId: string;
  assetId?: string;
  reason?: string;
  notes?: string;
};
type UpsertReferencesArgs = {
  projectId: string;
  referenceIds: string[];
  reason?: string;
  notes?: string;
};
type ProjectReferenceArgs = { projectId: string; referenceId: string };
type ProjectReferencesArgs = { projectId: string; referenceIds: string[] };

const listProjectsReference = makeFunctionReference<"query", {}, ReferenceProject[]>(
  "projects:list",
);
const createProjectReference = makeFunctionReference<
  "mutation",
  CreateProjectArgs,
  ReferenceProject
>("projects:create");
const updateProjectReference = makeFunctionReference<
  "mutation",
  UpdateProjectArgs,
  ReferenceProject
>("projects:update");
const removeProjectReference = makeFunctionReference<
  "mutation",
  ProjectIdArgs,
  { removed: boolean; usesRemoved: number }
>("projects:remove");
const listForReferenceReference = makeFunctionReference<
  "query",
  ReferenceIdArgs,
  ProjectReferenceUse[]
>("projects:listForReference");
const upsertReferenceReference = makeFunctionReference<
  "mutation",
  UpsertReferenceArgs,
  ProjectReferenceUse
>("projects:upsertReference");
const upsertReferencesReference = makeFunctionReference<
  "mutation",
  UpsertReferencesArgs,
  { updated: number }
>("projects:upsertReferences");
const removeReferenceReference = makeFunctionReference<
  "mutation",
  ProjectReferenceArgs,
  boolean
>("projects:removeReference");
const removeReferencesReference = makeFunctionReference<
  "mutation",
  ProjectReferencesArgs,
  { updated: number }
>("projects:removeReferences");

let client: ConvexHttpClient | undefined;
let projectsPromise: Promise<ReferenceProject[]> | undefined;
let projectsCache: ReferenceProject[] | undefined;
const listeners = new Set<(projects: ReferenceProject[]) => void>();

export function useAllReferenceProjects() {
  const [projects, setProjects] = useState<ReferenceProject[]>(projectsCache ?? []);

  useEffect(() => {
    listeners.add(setProjects);
    void loadProjects().then(setProjects).catch(() => undefined);
    return () => {
      listeners.delete(setProjects);
    };
  }, []);

  return projects;
}

export function useProjectUses(referenceId: string) {
  const [uses, setUses] = useState<ProjectReferenceUse[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getClient()
      .query(listForReferenceReference, { referenceId })
      .then((items) => {
        if (!cancelled) setUses(items);
      })
      .catch(() => {
        if (!cancelled) setUses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [referenceId]);

  return [uses, setUses] as const;
}

export async function createReferenceProject(
  name: string,
  description?: string,
  status: ProjectStatus = "active",
) {
  await getClient().mutation(createProjectReference, { name, description, status });
  return await refreshProjects();
}

export async function updateReferenceProject(
  projectId: string,
  args: { name: string; description?: string; status: ProjectStatus },
) {
  await getClient().mutation(updateProjectReference, { projectId, ...args });
  return await refreshProjects();
}

export async function removeReferenceProject(projectId: string) {
  const result = await getClient().mutation(removeProjectReference, { projectId });
  await refreshProjects();
  return result;
}

export async function saveProjectUse(args: UpsertReferenceArgs) {
  const result = await getClient().mutation(upsertReferenceReference, args);
  await refreshProjects();
  return result;
}

export async function saveProjectUses(args: UpsertReferencesArgs) {
  const result = await getClient().mutation(upsertReferencesReference, args);
  await refreshProjects();
  return result;
}

export async function removeProjectUse(projectId: string, referenceId: string) {
  const result = await getClient().mutation(removeReferenceReference, {
    projectId,
    referenceId,
  });
  await refreshProjects();
  return result;
}

export async function removeProjectUses(projectId: string, referenceIds: string[]) {
  const result = await getClient().mutation(removeReferencesReference, {
    projectId,
    referenceIds,
  });
  await refreshProjects();
  return result;
}

async function refreshProjects() {
  projectsPromise = undefined;
  projectsCache = undefined;
  const projects = await loadProjects();
  for (const listener of listeners) listener(projects);
  return projects;
}

async function loadProjects() {
  if (projectsCache) return projectsCache;
  if (!projectsPromise) {
    projectsPromise = getClient().query(listProjectsReference, {}).then((projects) => {
      projectsCache = projects;
      return projects;
    });
  }
  return await projectsPromise;
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before editing projects.");
  client = new ConvexHttpClient(url);
  return client;
}
