import { NextResponse } from "next/server";

const serverCard = {
    name: "subscript",
    version: "1.0.0",
    description: "SubScript Private Routing Protocol MCP Server",
    configSchema: {}
};

const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET() {
    return NextResponse.json(serverCard, { headers });
}

export async function POST() {
    return NextResponse.json(serverCard, { headers });
}

export async function PUT() {
    return NextResponse.json(serverCard, { headers });
}

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers,
    });
}
