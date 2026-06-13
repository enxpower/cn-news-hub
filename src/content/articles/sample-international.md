---
title: "示例文章：全球新闻聚合即将上线"
pubDate: 2026-06-13T10:40:00Z
sourceName: "中文新闻汇（示例数据）"
sourceUrl: "https://example.com/sample-international"
category: "international"
image: "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=1200&q=80"
description: "这是一篇示例文章，用于在自动抓取任务首次运行前预览网站排版与样式。系统上线后，此文章将被真实新闻内容自动替换。"
---

这是一篇**示例文章**，用于在 GitHub Actions 自动抓取任务首次运行前预览网站排版与样式。

当 `scripts/fetch-news.mjs` 首次成功运行后，系统会从 Notion 中配置的 RSS 新闻源抓取真实新闻，并自动生成对应的文章页面。本篇示例文章会在抓取任务清理过期内容时被自动归档或替换。

如果你现在看到的就是这段文字，说明站点结构摇供完成，下一步是配置 Notion 数据源密钥并触发首次抓取。
