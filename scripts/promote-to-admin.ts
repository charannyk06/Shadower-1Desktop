import "load-env";

// This script is deprecated - roles have been removed from the application.
// All authenticated users now have full access.

async function promoteToAdmin() {
  console.log("This script is deprecated.");
  console.log("Roles have been removed from the application.");
  console.log("All authenticated users now have full access.");
  process.exit(0);
}

promoteToAdmin().catch(console.error);
