import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
import { storage } from "./storage/resource"; // 👈 Import the storage file

defineBackend({
  auth,
  data,
  storage,
});
