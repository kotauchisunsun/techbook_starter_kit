export interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run: string;
  if?: string;
  with: {'node-version'?: string; file_glob: boolean; tag: string; target_commit: string; 'if-no-files-found': string; archive: boolean; ref: string; file: string; message: string; name: string; path: string; header: string; 'retention-days': number; 'persist-credentials': boolean};
  'continue-on-error'?: boolean;
  env: Record<string, string>
}
export interface Workflow {
  concurrency?: unknown;
  on: {pull_request_target?: unknown; pull_request: {types: string[]; branches?: string[]}};
  permissions: Record<string, string>;
  jobs: Record<string, {'runs-on': string; 'timeout-minutes': number; if: string; needs: string | string[]; permissions: Record<string, string>; concurrency: {group: string; 'cancel-in-progress': boolean}; steps: Step[]}>
}
