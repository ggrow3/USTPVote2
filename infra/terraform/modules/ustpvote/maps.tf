# The Candidates page's Google map (design §5.8): the Maps JavaScript API, and a browser key that works only for it and
# only on the web app's own origins. The key is public by nature: the api hands it to every visitor's browser
# (GET /v1/public/maps, GOOGLE_MAPS_BROWSER_KEY in run.tf). The API and referrer restrictions are what keep anyone else
# from spending the project's Maps quota. The districts and their outlines come from the Census Bureau's TIGERweb,
# which needs no key. Off with maps_enabled = false: the page then lists the candidacies without a map.

locals {
  # The hosting domains (identity.tf), localhost too outside production, and a custom web_origin if there is one.
  maps_referrers = concat(
    [for domain in local.web_domains : domain == "localhost" ? "http://localhost:*/*" : "https://${domain}/*"],
    var.web_origin != "" ? ["${var.web_origin}/*"] : [],
  )
}

resource "google_project_service" "maps" {
  for_each = var.maps_enabled ? toset(["apikeys.googleapis.com", "maps-backend.googleapis.com"]) : toset([])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_apikeys_key" "maps_browser" {
  count = var.maps_enabled ? 1 : 0

  project      = var.project_id
  name         = "maps-browser"
  display_name = "Google Maps on the Candidates page (browser)"

  restrictions {
    api_targets {
      service = "maps-backend.googleapis.com"
    }
    browser_key_restrictions {
      allowed_referrers = local.maps_referrers
    }
  }

  depends_on = [google_project_service.maps]
}
