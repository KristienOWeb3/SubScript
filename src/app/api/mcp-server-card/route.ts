import { NextResponse } from "next/server";

export async function GET() {
    return NextResponse.json({
        name: "subscript",
        version: "1.0.0",
        description: "SubScript ZK Protocol MCP Server",
        configSchema: {}
    }, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    });
}

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    });
}
