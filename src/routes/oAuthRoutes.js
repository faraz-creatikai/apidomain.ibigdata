import express from "express";

const oauthRoutes = express.Router();
const BASE_URL = "https://apidomain.ibigdata.in";

const handleResourceMetadata = (req, res) => {
  res.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL]
  });
};

// 1. Catch ALL variations of the Protected Resource Metadata path Claude probes
oauthRoutes.get("/.well-known/oauth-protected-resource", handleResourceMetadata);
oauthRoutes.get("/.well-known/oauth-protected-resource/*", handleResourceMetadata);

// 2. OAuth 2.0 Authorization Server Metadata (RFC 8414)
oauthRoutes.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth2/authorize`,
    token_endpoint: `${BASE_URL}/oauth2/token`,
    registration_endpoint: `${BASE_URL}/oauth2/register`,
    scopes_supported: ["offline_access"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"]
  });
});

// 3. Dynamic Client Registration (DCR)
oauthRoutes.post("/oauth2/register", express.json(), (req, res) => {
  res.json({
    client_id: "claude-web-dummy-client",
    redirect_uris: req.body.redirect_uris || [],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "offline_access"
  });
});

// 4. Authorization Redirect
oauthRoutes.get("/oauth2/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  if (!redirect_uri) return res.status(400).send("Missing redirect_uri");

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", "dummy_auth_code_12345");
  redirectUrl.searchParams.set("state", state);
  
  res.redirect(redirectUrl.toString());
});

// 5. Token Exchange
oauthRoutes.post("/oauth2/token", express.urlencoded({ extended: true }), (req, res) => {
  res.json({
    access_token: "crm_mcp_live_token_999",
    token_type: "Bearer",
    expires_in: 31536000,
    refresh_token: "crm_mcp_refresh_token_888",
    scope: "offline_access"
  });
});

export default oauthRoutes;