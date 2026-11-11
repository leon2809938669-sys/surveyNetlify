import React from "react";
import { Check } from "lucide-react";

export default function Brand({ compact = false }) {
  return <div className="brand">
    <span className="brand-mark" aria-hidden="true"><Check size={23} strokeWidth={2.5} /></span>
    <span><strong>问卷工作台<span className="brand-period">.</span></strong>{!compact && <small>SURVEY WORKSPACE</small>}</span>
  </div>;
}
