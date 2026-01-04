'use client';

import React, { useState } from 'react';
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// --- Utilities ---

/**
 * Combines multiple class names and merges Tailwind classes correctly.
 */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Interfaces ---

export interface ProjectFolderProps {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  pagesCrawled: number;
  lastCrawled: string | null;
  className?: string;
  gradient?: string;
  href?: string;
  children?: React.ReactNode;
}

// --- Component ---

const AnimatedFolder: React.FC<ProjectFolderProps> = ({ 
  id,
  name, 
  domain,
  baseUrl,
  pagesCrawled,
  lastCrawled,
  className, 
  gradient,
  href,
  children
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const router = useRouter();

  const backBg = gradient || "linear-gradient(135deg, var(--folder-back) 0%, var(--folder-tab) 100%)";
  const tabBg = gradient || "var(--folder-tab)";
  const frontBg = gradient || "linear-gradient(135deg, var(--folder-front) 0%, var(--folder-back) 100%)";

  const formatLastCrawled = (dateString: string | null): string => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return date.toLocaleDateString();
  };

  const handleFolderClick = (e: React.MouseEvent) => {
    // Only navigate if clicking on the folder itself, not on buttons or links
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="button"]') || target.tagName === 'BUTTON' || target.tagName === 'A') {
      return;
    }
    if (href) {
      router.push(href);
    }
  };

  const folderContent = (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center p-8 rounded-2xl transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:shadow-2xl group",
        "bg-[var(--card)] border border-[var(--border)]",
        "hover:shadow-[var(--accent)]/20 hover:border-[var(--accent)]/40",
        href ? "cursor-pointer" : "",
        className
      )}
      style={{ 
        minWidth: "280px", 
        minHeight: children ? "400px" : "320px", 
        perspective: "1200px", 
        transform: isHovered ? "scale(1.04) rotate(-1.5deg)" : "scale(1) rotate(0deg)" 
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleFolderClick}
    >
      <div
        className="absolute inset-0 rounded-2xl transition-opacity duration-700"
        style={{ 
          background: gradient 
            ? `radial-gradient(circle at 50% 70%, ${gradient.match(/#[a-fA-F0-9]{3,6}/)?.[0] || 'var(--accent)'} 0%, transparent 70%)` 
            : "radial-gradient(circle at 50% 70%, var(--accent) 0%, transparent 70%)", 
          opacity: isHovered ? 0.12 : 0 
        }}
      />
      
      {/* 3D Folder Animation */}
      <div className="relative flex items-center justify-center mb-4" style={{ height: "160px", width: "200px" }}>
        {/* Back folder */}
        <div 
          className="absolute w-32 h-24 rounded-lg shadow-md border border-white/10" 
          style={{ 
            background: backBg, 
            filter: gradient ? "brightness(0.9)" : "none", 
            transformOrigin: "bottom center", 
            transform: isHovered ? "rotateX(-20deg) scaleY(1.05)" : "rotateX(0deg) scaleY(1)", 
            transition: "transform 700ms cubic-bezier(0.16, 1, 0.3, 1)", 
            zIndex: 10 
          }} 
        />
        
        {/* Tab */}
        <div 
          className="absolute w-12 h-4 rounded-t-md border-t border-x border-white/10" 
          style={{ 
            background: tabBg, 
            filter: gradient ? "brightness(0.85)" : "none", 
            top: "calc(50% - 48px - 12px)", 
            left: "calc(50% - 64px + 16px)", 
            transformOrigin: "bottom center", 
            transform: isHovered ? "rotateX(-30deg) translateY(-3px)" : "rotateX(0deg) translateY(0)", 
            transition: "transform 700ms cubic-bezier(0.16, 1, 0.3, 1)", 
            zIndex: 10 
          }} 
        />
        
        {/* Front folder */}
        <div 
          className="absolute w-32 h-24 rounded-lg shadow-lg border border-white/20" 
          style={{ 
            background: frontBg, 
            top: "calc(50% - 48px + 4px)", 
            transformOrigin: "bottom center", 
            transform: isHovered ? "rotateX(35deg) translateY(12px)" : "rotateX(0deg) translateY(0)", 
            transition: "transform 700ms cubic-bezier(0.16, 1, 0.3, 1)", 
            zIndex: 30 
          }} 
        />
        
        {/* Shine effect */}
        <div 
          className="absolute w-32 h-24 rounded-lg overflow-hidden pointer-events-none" 
          style={{ 
            top: "calc(50% - 48px + 4px)", 
            background: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 60%)", 
            transformOrigin: "bottom center", 
            transform: isHovered ? "rotateX(35deg) translateY(12px)" : "rotateX(0deg) translateY(0)", 
            transition: "transform 700ms cubic-bezier(0.16, 1, 0.3, 1)", 
            zIndex: 31 
          }} 
        />
      </div>
      
      {/* Project Info */}
      <div className="text-center w-full">
        <h3 
          className="text-lg font-bold text-[var(--foreground)] mt-4 transition-all duration-500 mb-2" 
          style={{ 
            transform: isHovered ? "translateY(2px)" : "translateY(0)", 
            letterSpacing: isHovered ? "-0.01em" : "0" 
          }}
        >
          {name}
        </h3>
        <p 
          className="text-sm font-medium text-[var(--muted-foreground)] transition-all duration-500 mb-3 truncate px-2" 
          style={{ opacity: isHovered ? 0.8 : 1 }}
        >
          {baseUrl}
        </p>
        
        {/* Stats */}
        <div className="space-y-1.5 text-xs text-[var(--muted-foreground)] transition-all duration-500" style={{ opacity: isHovered ? 0.9 : 0.7 }}>
          <div className="flex justify-between px-4">
            <span>Pages Crawled:</span>
            <span className="font-semibold text-[var(--foreground)]">{pagesCrawled.toLocaleString()}</span>
          </div>
          <div className="flex justify-between px-4">
            <span>Last Crawled:</span>
            <span className="font-semibold text-[var(--foreground)]">{formatLastCrawled(lastCrawled)}</span>
          </div>
        </div>
      </div>
      
      {/* Buttons Section */}
      {children && (
        <div className="mt-4 w-full relative z-10" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );

  // Don't wrap in Link if there are children (buttons) - they need to handle clicks
  if (href && !children) {
    return (
      <Link href={href} className="block">
        {folderContent}
      </Link>
    );
  }

  return folderContent;
};

export default AnimatedFolder;

