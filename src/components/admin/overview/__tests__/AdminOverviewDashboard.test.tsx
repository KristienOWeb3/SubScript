import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AdminOverviewDashboard } from "../AdminOverviewDashboard";

const baseProps = {
  analyticsData: null,
  sponsor: null,
  totalUsers: null,
  onNavigateTab: () => {},
  onToggleVerification: async () => {},
  verifyBusy: null,
};

describe("AdminOverviewDashboard", () => {
  it("renders before the initial admin overview request completes", () => {
    assert.doesNotThrow(() => {
      renderToStaticMarkup(
        React.createElement(AdminOverviewDashboard, {
          ...baseProps,
          overviewData: null,
          merchants: [],
        })
      );
    });
  });

  it("renders a partial response with a non-array timeline and incomplete merchants", () => {
    assert.doesNotThrow(() => {
      renderToStaticMarkup(
        React.createElement(AdminOverviewDashboard, {
          ...baseProps,
          overviewData: { metrics: { timeline14d: {} } },
          merchants: [{ walletAddress: null, merchantName: null, verified: false }],
        })
      );
    });
  });
});
