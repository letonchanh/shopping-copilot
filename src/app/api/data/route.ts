// Fetches user data from their Personal Server using an approved grant.
// Fetches each scope independently so a failure in one doesn't block the rest.

import { NextResponse } from "next/server";
import { createDataClient } from "@opendatalabs/connect/server";
import { ConnectError, isValidGrant, getEnvConfig } from "@opendatalabs/connect/core";
import { config } from "@/config";

export async function POST(request: Request) {
  const { grant } = await request.json();

  if (!isValidGrant(grant)) {
    return NextResponse.json(
      { error: "Invalid grant payload" },
      { status: 400 },
    );
  }

  try {
    const { gatewayUrl } = getEnvConfig(config.environment);
    const dataClient = createDataClient({
      privateKey: config.privateKey,
      gatewayUrl,
    });

    const serverUrl = await dataClient.resolveServerUrl(
      grant.serverAddress ?? grant.userAddress,
    );

    const results = await Promise.allSettled(
      grant.scopes.map(async (scope: string) => {
        const result = await dataClient.fetchData({
          serverUrl,
          scope,
          grantId: grant.grantId,
        });
        return [scope, result] as const;
      }),
    );

    const data: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        const [scope, value] = result.value;
        data[scope] = value;
      } else {
        console.warn("[POST /api/data] scope fetch failed:", result.reason);
        errors.push(String(result.reason));
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "All scope fetches failed", details: errors },
        { status: 502 },
      );
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[POST /api/data] data fetch failed:", err);
    const message =
      err instanceof ConnectError ? err.message : "Failed to fetch data";
    const status = err instanceof ConnectError ? (err.statusCode ?? 500) : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
