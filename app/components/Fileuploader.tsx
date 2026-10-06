"use client";

import React, { ChangeEvent } from "react";

interface SingleFileUploaderProps {
  onFileSelect?: (file: File | null) => void;
}

export default function SingleFileUploader({ onFileSelect }: SingleFileUploaderProps) {
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (onFileSelect) {
      onFileSelect(file);
    }
  };

  return (
    <div className="full" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <label style={{ margin: 0 }}>Workpal Screenshot (Optional)</label>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <input 
          type="file" 
          accept="image/*,.pdf" 
          onChange={handleFileChange}
          style={{ flex: "1 1 200px" }}
        />
        <small style={{ color: "var(--text-muted, #666)", fontStyle: "italic", flex: "2 1 250px" }}>
          Remember to upload your workpal screenshot as soon as possible!
        </small>
      </div>
    </div>
  );
}