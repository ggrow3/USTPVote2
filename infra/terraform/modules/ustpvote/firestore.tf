# The (default) Firestore database in Native mode (design §11). Rules and indexes come from infra/firebase and are
# deployed with the Firebase CLI. Destroying this resource only forgets it (deletion_policy ABANDON).
resource "google_firestore_database" "default" {
  project                           = var.project_id
  name                              = "(default)"
  location_id                       = local.firestore_location
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "PESSIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = var.deletion_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
  deletion_policy                   = "ABANDON"

  depends_on = [google_project_service.this]
}
