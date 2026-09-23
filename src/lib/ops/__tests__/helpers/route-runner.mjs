const { GET } = await import("../../../../app/api/cli/config/route.ts");
const res = await GET();
const json = await res.json();
if (process.send) {
  process.send({ status: res.status, ...json });
} else {
  console.log(JSON.stringify({ status: res.status, ...json }));
}
