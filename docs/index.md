---
layout: home

hero:
  name: CodeFuse-Query
  text: 深度指南
  tagline: 蚂蚁集团开源的以数据为中心的静态代码分析系统——从核心概念、安装与第一个查询，到编译器前端与抽取器源码级剖析的完整知识地图
  actions:
    - theme: brand
      text: 开始阅读
      link: /intro
    - theme: alt
      text: 入门指南
      link: /beginner/01-overview
    - theme: alt
      text: 专项评估
      link: /telecom/applicability

features:
  - title: 入门级指南
    details: 什么是 CodeFuse-Query、COREF 与 Gödel 核心概念、安装配置、第一个查询、Sparrow CLI 与典型分析示例。
    link: /beginner/01-overview
  - title: 进阶级指南（源码级）
    details: Gödel 语言全量语法、编译器五层架构、名称修饰与 Soufflé 代码生成、C/C++ 与 Java 抽取器源码剖析、性能调优与打包分发。
    link: /advanced/07-godel-language
  - title: 专项评估
    details: 面向电信/嵌入式大型 C/C++ 代码仓负责人的千万行级系统适用性评估，含结论与风险清单。
    link: /telecom/applicability
  - title: LLM 代码审核集成
    details: 与 mcp-language-server 的结合方式，以及面向 LLM 代码审核的落地路线与验证方案。
    link: /llm/16-integration
---
