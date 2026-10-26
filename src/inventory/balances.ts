import { createPublicClient, erc20Abi, formatUnits, http, type Address, type PublicClient } from "viem";
import { celo } from "viem/chains";
import type { Inventory } from "../pricing/engine.js";

export function makeClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: celo, transport: http(rpcUrl) }) as PublicClient;
}

const decimalsCache = new Map<Address, number>();

export async function decimals(client: PublicClient, token: Address): Promise<number> {
  const hit = decimalsCache.get(token);
  if (hit !== undefined) return hit;
  const d = await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
  decimalsCache.set(token, d);
  return d;
}

export async function balanceOf(client: PublicClient, token: Address, owner: Address): Promise<number> {
  const [raw, d] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    decimals(client, token),
  ]);
  return Number(formatUnits(raw, d));
}

export async function readInventory(
  client: PublicClient,
  owner: Address,
  usdt: Address,
  cngn: Address,
): Promise<Inventory> {
  const [u, n] = await Promise.all([balanceOf(client, usdt, owner), balanceOf(client, cngn, owner)]);
  return { usdt: u, cngn: n };
}
