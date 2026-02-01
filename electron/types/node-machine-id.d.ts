declare module "node-machine-id" {
  export function machineIdSync(original?: boolean): string;
  export function machineId(original?: boolean): Promise<string>;
}
