---
layout: new-layouts/base
title: Documentation
---

<div class="get-started">

<!-- Hero -->

{% include new-includes/components/doc-hero.html content = site.data.new-data.documentation.hero %}

<!-- Learning Swift -->

{% include new-includes/components/doc-card-grid.html content = site.data.new-data.documentation.learning %}

<!-- Build Tools -->

{% include new-includes/components/doc-card-grid.html content = site.data.new-data.documentation.build-tools %}

<!-- Compiler & Diagnostics -->

{% include new-includes/components/doc-card-grid.html content = site.data.new-data.documentation.compiler %}

<!-- Specialized Platforms -->

{% include new-includes/components/doc-card-grid.html content = site.data.new-data.documentation.specialized %}

</div>
