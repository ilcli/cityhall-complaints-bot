import { google } from 'googleapis';
import fs from 'fs';
import fetch from 'node-fetch';
import { Readable } from 'stream';
import { ConfigurationError } from './utils/errors.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata'
];

const credsPath = './creds/service-account.json';
let auth = null;
let driveService = null;

// Shared folder ID from environment variable - resolves service account storage quota issue
const SHARED_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1pj0xHUKVFxMaYz3Eww3PXwCajq_3nGTN';

/**
 * Initialize Google Drive auth (reuses same service account as Sheets)
 */
function initializeDriveAuth() {
  if (auth && driveService) return;

  try {
    const credentials = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [...SCOPES, 'https://www.googleapis.com/auth/spreadsheets'],
    });
    
    driveService = google.drive({ version: 'v3', auth });
    console.log('✅ Google Drive API initialized');
  } catch (error) {
    throw new ConfigurationError(`Failed to initialize Google Drive Auth: ${error.message}`);
  }
}

/**
 * Verify access to the shared folder and return folder ID
 */
async function verifySharedFolderAccess() {
  try {
    initializeDriveAuth();
    
    // Verify we can access the shared folder
    const folderInfo = await driveService.files.get({
      fileId: SHARED_FOLDER_ID,
      fields: 'id, name, mimeType, permissions',
    });
    
    console.log(`📁 Verified access to shared folder: ${folderInfo.data.name} (${SHARED_FOLDER_ID})`);
    return SHARED_FOLDER_ID;
  } catch (error) {
    console.error('❌ Failed to access shared folder:', error.message);
    
    if (error.code === 404) {
      throw new Error(`Shared folder ${SHARED_FOLDER_ID} not found. Please verify the folder ID and ensure the service account has access.`);
    } else if (error.code === 403) {
      throw new Error(`Access denied to shared folder ${SHARED_FOLDER_ID}. Please share the folder with the service account email.`);
    } else {
      throw new Error(`Failed to access shared folder: ${error.message}`);
    }
  }
}

/**
 * Download image from WhatsApp/Meta URL
 */
async function downloadImage(imageUrl, accessToken = null) {
  try {
    const headers = {};
    
    // Add authorization if we have a Meta access token
    if (accessToken || process.env.META_ACCESS_TOKEN) {
      headers['Authorization'] = `Bearer ${accessToken || process.env.META_ACCESS_TOKEN}`;
    }
    
    console.log(`⬇️ Downloading image from: ${imageUrl}`);
    const response = await fetch(imageUrl, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    console.log(`✅ Downloaded image (${buffer.length} bytes, type: ${contentType})`);
    return { buffer, contentType };
  } catch (error) {
    console.error('❌ Failed to download image:', error.message);
    throw error;
  }
}

/**
 * Upload image to Google Drive and return shareable link
 */
export async function uploadImageToDrive(imageUrl, metadata = {}) {
  try {
    initializeDriveAuth();
    
    // Verify access to shared folder
    const folderId = await verifySharedFolderAccess();
    
    // Download the image from WhatsApp
    const { buffer, contentType } = await downloadImage(imageUrl);
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = contentType.split('/')[1] || 'jpg';
    const filename = `complaint_${metadata.sender || 'unknown'}_${timestamp}.${extension}`;
    
    // Upload to Google Drive
    const fileMetadata = {
      name: filename,
      parents: [folderId],
      description: `WhatsApp complaint image from ${metadata.sender || 'unknown'} at ${metadata.timestamp || timestamp}`,
    };
    
    const media = {
      mimeType: contentType,
      body: Readable.from(buffer),
    };
    
    console.log(`📤 Uploading image to shared Drive folder: ${filename}`);
    
    const file = await driveService.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink',
    });
    
    // Make file accessible to anyone with link (with proper error handling for shared folders)
    try {
      await driveService.permissions.create({
        fileId: file.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
      console.log(`🔗 File permissions set for public access`);
    } catch (permissionError) {
      console.warn(`⚠️ Could not set public permissions (shared folder may have restrictions): ${permissionError.message}`);
      console.log(`📝 File uploaded successfully but permissions may be inherited from shared folder`);
    }
    
    // Get shareable link
    const shareableLink = `https://drive.google.com/file/d/${file.data.id}/view?usp=sharing`;
    
    console.log(`✅ Image uploaded to Drive: ${shareableLink}`);
    
    return {
      driveId: file.data.id,
      shareableLink,
      webViewLink: file.data.webViewLink,
      filename,
    };
  } catch (error) {
    console.error('❌ Failed to upload image to Drive:', error.message);
    
    // Provide specific error messages for common shared folder issues
    if (error.message.includes('shared folder')) {
      console.error('   Please ensure the service account has been granted access to the shared folder.');
      console.error('   Share the folder with the service account email from your Google Cloud credentials.');
    } else if (error.code === 403) {
      console.error('   Access denied. Check that the service account has proper permissions.');
    } else if (error.code === 404) {
      console.error('   Shared folder not found. Verify the folder ID is correct.');
    }
    
    // Return null instead of throwing to not break the flow
    return null;
  }
}

/**
 * Delete an image from Google Drive
 */
export async function deleteImageFromDrive(fileId) {
  try {
    initializeDriveAuth();
    
    await driveService.files.delete({
      fileId: fileId,
    });
    
    console.log(`🗑️ Deleted image from Drive: ${fileId}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to delete image from Drive:', error.message);
    return false;
  }
}

export default {
  uploadImageToDrive,
  deleteImageFromDrive,
};