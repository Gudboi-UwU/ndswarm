// TanStack Query keys, shared so mutations invalidate the right lists.
export const keys = {
  projects: ['projects'] as const,
  project: (id: number) => ['project', id] as const,
  tests: (projectId: number) => ['project', projectId, 'tests'] as const,
  environments: (projectId: number) => ['project', projectId, 'environments'] as const,
  test: (id: number) => ['test', id] as const,
  generators: ['generators'] as const,
  run: (id: number) => ['run', id] as const,
  timeseries: (id: number) => ['run', id, 'timeseries'] as const,
  activeRun: ['runs', 'active'] as const,
  runs: (testId?: number) => ['runs', testId ?? 'all'] as const,
}
