<?php

namespace Grav\Plugin;

use Grav\Common\Page\Page;
use Grav\Common\Utils;
use Grav\Common\Plugin;
use Grav\Common\Yaml;

class MiniwriterPlugin extends Plugin
{
    /**
     * @return array
     */
    public static function getSubscribedEvents(): array
    {
        return [
            'onPluginsInitialized' => ['onPluginsInitialized', 0],
        ];
    }

    public function onPluginsInitialized(): void
    {
        if ($this->isAdmin()) {
            return;
        }

        $user = $this->grav['user'];
        if (!$user || !$user->authenticated || !$user->authorize('admin.login')) {
            return;
        }

        $this->enable([
            'onPagesInitialized' => ['onPagesInitialized', 0],
            'onTwigTemplatePaths' => ['onTwigTemplatePaths', 0],
            'onTwigSiteVariables' => ['onTwigSiteVariables', 0],
        ]);
    }

    public function onPagesInitialized(): void
    {
        $uri = $this->grav['uri'];
        $route = trim($this->config->get('plugins.miniwriter.route', '/miniwriter'), '/');
        $path = trim($uri->path(), '/');

        if ($route !== $path) {
            return;
        }

        $this->processTaskRequest();

        $page = new Page();
        $page->init(new \SplFileInfo(__DIR__ . '/pages/miniwriter.md'));
        $page->template('miniwriter');
        $page->title('MiniWriter');
        $page->rawRoute($uri->path());
        $this->grav['page'] = $page;
    }

    public function onTwigTemplatePaths(): void
    {
        $this->grav['twig']->twig_paths[] = __DIR__ . '/templates';
    }

    public function onTwigSiteVariables(): void
    {
        $uri = $this->grav['uri'];
        $route = trim($this->config->get('plugins.miniwriter.route', '/miniwriter'), '/');
        $path = trim($uri->path(), '/');
        if ($route !== $path) {
            return;
        }

        $user = $this->grav['user'];

        $twig = $this->grav['twig'];
        $twig->twig_vars['miniwriter'] = [
            'config' => $this->getPublicConfig(),
            'pages' => $this->getPageSummaries(),
            'user' => [
                'username' => $user ? $user->username : null,
                'name' => $user ? ($user->fullname ?: $user->username) : null,
            ],
        ];

        $assets = $this->grav['assets'];
        $assets->addCss('plugin://miniwriter/assets/css/miniwriter.css');
        $assets->addJs('plugin://miniwriter/assets/js/miniwriter.js', ['group' => 'bottom', 'loading' => 'defer']);
    }

    private function getPublicConfig(): array
    {
        $config = $this->config->get('plugins.miniwriter');

        return [
            'route' => $config['route'],
            'default_parent' => $config['default_parent'],
            'autosave_interval' => (int)($config['autosave_interval'] ?? 8),
            'markdown_toolbar' => (bool)($config['markdown_toolbar'] ?? false),
            'allow_images' => (bool)($config['allow_images'] ?? false),
            'default_published' => (bool)($config['default_published'] ?? false),
            'conflict_prefix' => $config['conflict_prefix'] ?? '(copie)',
            'editor_font_size' => $config['editor_font_size'] ?? 'medium',
            'theme' => $config['theme'] ?? 'auto',
            'server_preview' => (bool)($config['server_preview'] ?? false),
        ];
    }

    private function getPageSummaries(): array
    {
        $defaultParent = $this->config->get('plugins.miniwriter.default_parent');
        $pages = $this->grav['pages'];
        $collection = [];

        if ($defaultParent) {
            $parent = $pages->find($defaultParent);
            if ($parent) {
                // Some Grav versions require 2 args for Collection::add().
                // Avoid calling add() and merge results explicitly to keep compatibility.
                $published = $parent->children()->published();
                $unpublished = $parent->children()->unpublished();
                $collection = array_merge(
                    iterator_to_array($published),
                    iterator_to_array($unpublished)
                );
            }
        }

        if (!$collection) {
            $collection = $pages->all();
        }

        $list = [];
        $pluginRoute = '/' . trim($this->config->get('plugins.miniwriter.route', '/miniwriter'), '/');

        foreach ($collection as $page) {
            if ($page->route() === $pluginRoute) {
                continue;
            }
            if ($page->template() === 'modular') {
                continue;
            }
            $list[] = $this->serializePageSummary($page);
        }

        usort($list, function ($a, $b) {
            return strcmp($b['updated_at'] ?? $b['date'] ?? '', $a['updated_at'] ?? $a['date'] ?? '');
        });

        return $list;
    }

    private function serializePageSummary(Page $page): array
    {
        $file = $page->path() . '/' . $page->name();
        $hash = is_file($file) ? md5_file($file) : null;
        $header = (array)json_decode(json_encode($page->header()), true);

        return [
            'title' => $page->title(),
            'route' => $page->route(),
            'id' => $page->id(),
            'slug' => $page->slug(),
            'parent_route' => $page->parent() ? $page->parent()->route() : '/',
            'date' => $page->date() ? date(DATE_ATOM, $page->date()) : null,
            'modified' => $page->modified() ? date(DATE_ATOM, $page->modified()) : null,
            'published' => $page->published(),
            'status' => $page->published() ? 'published' : 'draft',
            'server_hash' => $hash,
            'updated_at' => $header['updated_at'] ?? null,
        ];
    }

    private function processTaskRequest(): void
    {
        $request = $this->grav['request'] ?? null;
        $method = $request ? $request->getMethod() : ($_SERVER['REQUEST_METHOD'] ?? 'GET');
        if (!in_array($method, ['GET', 'POST'], true)) {
            return;
        }

        $input = $this->getJsonInput();
        $task = $input['task'] ?? $this->grav['uri']->query('task');

        if (!$task) {
            return;
        }

        $user = $this->grav['user'];
        if (!$user || !$user->authenticated || !$user->authorize('admin.login')) {
            $this->jsonResponse(['status' => 'error', 'message' => 'Access denied'], 403);
        }

        $this->grav['debugger']->enabled(false);

        switch ($task) {
            case 'miniwriter.list':
                $this->jsonResponse(['status' => 'ok', 'pages' => $this->getPageSummaries()]);
                break;
            case 'miniwriter.page':
                $this->jsonResponse($this->getPageDetail($input['route'] ?? null));
                break;
            case 'miniwriter.save':
                $this->jsonResponse($this->savePage($input));
                break;
            case 'miniwriter.duplicate':
                $this->jsonResponse($this->duplicatePage($input));
                break;
            default:
                $this->jsonResponse(['status' => 'error', 'message' => 'Unknown task'], 400);
                break;
        }
    }

    private function getJsonInput(): array
    {
        $request = $this->grav['request'] ?? null;
        $body = $request ? $request->getBody() : file_get_contents('php://input');
        if (!$body) {
            return [];
        }

        $json = json_decode($body, true);
        return is_array($json) ? $json : [];
    }

    private function jsonResponse(array $data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }

    private function getPageDetail(?string $route): array
    {
        if (!$route) {
            return ['status' => 'error', 'message' => 'Missing route'];
        }

        $page = $this->grav['pages']->find($route);
        if (!$page) {
            return ['status' => 'error', 'message' => 'Page not found'];
        }

        $file = $page->path() . '/' . $page->name();
        $hash = is_file($file) ? md5_file($file) : null;
        $header = json_decode(json_encode($page->header()), true) ?? [];
        $tags = $header['tags'] ?? [];
        if (is_string($tags)) {
            $tags = array_values(array_filter(array_map('trim', explode(',', $tags))));
        }
        $content = $page->rawMarkdown();

        return [
            'status' => 'ok',
            'page' => [
                'title' => $page->title(),
                'route' => $page->route(),
                'slug' => $page->slug(),
                'parent_route' => $page->parent() ? $page->parent()->route() : '/',
                'date' => $page->date() ? date(DATE_ATOM, $page->date()) : date(DATE_ATOM),
                'tags' => $tags,
                'published' => $page->published(),
                'content' => $content,
                'server_hash' => $hash,
                'updated_at' => $header['updated_at'] ?? null,
                'created_at' => $header['created_at'] ?? null,
            ],
        ];
    }

    private function savePage(array $payload): array
    {
        $title = trim($payload['title'] ?? '');
        $content = $payload['content'] ?? '';
        $route = $payload['route'] ?? null;
        $parentRoute = $payload['parent_route'] ?? $this->config->get('plugins.miniwriter.default_parent');
        $published = (bool)($payload['published'] ?? false);
        $dateValue = $payload['date'] ?? date(DATE_ATOM);
        $tags = $payload['tags'] ?? [];
        $serverHash = $payload['server_hash'] ?? null;
        $force = (bool)($payload['force'] ?? false);
        $slug = $payload['slug'] ?? null;
        $template = $payload['template'] ?? 'item';

        if ($title === '') {
            return ['status' => 'error', 'message' => 'Title is required'];
        }

        $pages = $this->grav['pages'];
        if ($parentRoute && $parentRoute !== '/') {
            $parentRoute = '/' . ltrim($parentRoute, '/');
            $parent = $pages->find($parentRoute);
        } else {
            $parentRoute = '/';
            $parent = $pages->root();
        }
        if (!$parent) {
            return ['status' => 'error', 'message' => 'Parent page not found'];
        }

        $page = null;
        if ($route) {
            $page = $pages->find($route);
        }

        $isNew = $page === null;

        if (!$slug) {
            $slug = $this->slugify($title);
        }

        $date = strtotime($dateValue) ?: time();
        $header = $page ? json_decode(json_encode($page->header()), true) : [];
        $header['title'] = $title;
        $header['date'] = date(DATE_ATOM, $date);
        $header['published'] = $published;
        $header['updated_at'] = date(DATE_ATOM);
        if ($isNew || empty($header['created_at'])) {
            $header['created_at'] = date(DATE_ATOM);
        }
        if ($tags) {
            $header['tags'] = is_array($tags) ? array_values(array_filter(array_map('trim', $tags))) : array_values(array_filter(array_map('trim', explode(',', (string)$tags))));
        } elseif (isset($header['tags'])) {
            unset($header['tags']);
        }

        $pageDir = $this->resolvePageDirectory($parent, $page, $slug);
        if (isset($pageDir['error'])) {
            return $pageDir;
        }

        $slug = $pageDir['slug'];
        $filePath = $pageDir['path'] . '/' . $template . '.md';
        $existingHash = is_file($filePath) ? md5_file($filePath) : null;

        if ($existingHash && !$force && $serverHash && $existingHash !== $serverHash) {
            return [
                'status' => 'conflict',
                'message' => 'Server version has changed',
                'server_hash' => $existingHash,
            ];
        }

        if (!is_dir($pageDir['path'])) {
            mkdir($pageDir['path'], 0775, true);
        }

        $yaml = trim(Yaml::dump($header, 2, 4, Yaml::DUMP_MULTI_LINE_LITERAL_BLOCK));
        $body = rtrim((string)$content);
        $output = "---\n" . $yaml . "\n---\n\n" . $body . (strlen($body) ? "\n" : '');

        file_put_contents($filePath, $output);

        $pages->reset();

        $routeValue = $this->buildRoute($parent->route(), $slug);
        $savedPage = $pages->find($routeValue);

        return [
            'status' => 'ok',
            'route' => $savedPage ? $savedPage->route() : $routeValue,
            'slug' => $slug,
            'parent_route' => $parent->route(),
            'title' => $title,
            'server_hash' => md5_file($filePath),
        ];
    }

    private function duplicatePage(array $payload): array
    {
        $route = $payload['route'] ?? null;
        if (!$route) {
            return ['status' => 'error', 'message' => 'Missing route'];
        }

        $pages = $this->grav['pages'];
        $page = $pages->find($route);
        if (!$page) {
            return ['status' => 'error', 'message' => 'Page not found'];
        }

        $prefix = $this->config->get('plugins.miniwriter.conflict_prefix', '(copie)');
        $newTitle = trim($prefix . ' ' . $page->title());
        $slug = $this->slugify($newTitle);

        $parent = $page->parent() ?: $pages->root();
        $dirData = $this->resolvePageDirectory($parent, null, $slug);
        if (isset($dirData['error'])) {
            return $dirData;
        }

        $source = $page->path();
        $target = $dirData['path'];
        $slug = $dirData['slug'];
        $this->copyDirectory($source, $target);

        $filePath = $target . '/' . $page->name();
        if (is_file($filePath)) {
            $content = file_get_contents($filePath);
            $header = $page->header();
            $header->title = $newTitle;
            $header->updated_at = date(DATE_ATOM);
            if (empty($header->created_at)) {
                $header->created_at = date(DATE_ATOM);
            }
            $yaml = trim(Yaml::dump(json_decode(json_encode($header), true), 2, 4, Yaml::DUMP_MULTI_LINE_LITERAL_BLOCK));
            $body = rtrim((string)$page->rawMarkdown());
            $output = "---\n" . $yaml . "\n---\n\n" . $body . (strlen($body) ? "\n" : '');
            file_put_contents($filePath, $output);
        }

        $pages->reset();
        $routeValue = $this->buildRoute($parent->route(), $slug);
        $newPage = $pages->find($routeValue);

        return [
            'status' => 'ok',
            'route' => $newPage ? $newPage->route() : $routeValue,
            'slug' => $slug,
            'title' => $newTitle,
        ];
    }

    private function resolvePageDirectory($parent, ?Page $page, string $slug): array
    {
        $basePath = $parent->path();
        $targetSlug = $slug ?: $this->slugify('item');
        $targetPath = $basePath . '/' . $targetSlug;
        $baseSlug = $targetSlug;

        if ($page) {
            $currentPath = $page->path();
            if ($currentPath !== $targetPath) {
                if (is_dir($targetPath)) {
                    return ['status' => 'error', 'message' => 'Target folder already exists', 'error' => true];
                }
                rename($currentPath, $targetPath);
            }
        } else {
            $counter = 1;
            while (is_dir($targetPath)) {
                $targetSlug = $baseSlug . '-' . $counter;
                $targetPath = $basePath . '/' . $targetSlug;
                $counter++;
            }
        }

        return ['path' => $targetPath, 'slug' => $targetSlug];
    }

    private function buildRoute(string $parentRoute, string $slug): string
    {
        $trimmed = trim($parentRoute, '/');
        if ($trimmed === '') {
            return '/' . ltrim($slug, '/');
        }

        return '/' . trim($trimmed . '/' . $slug, '/');
    }

    private function slugify(string $text): string
    {
        if (method_exists(Utils::class, 'slug')) {
            return Utils::slug($text);
        }

        if (method_exists(Utils::class, 'slugify')) {
            return Utils::slugify($text);
        }

        $text = strtolower(trim($text));
        $text = preg_replace('/[^a-z0-9\-]+/i', '-', $text) ?: '';

        return trim($text, '-') ?: 'item';
    }

    private function copyDirectory(string $source, string $destination): void
    {
        if (!is_dir($source)) {
            return;
        }

        if (!is_dir($destination)) {
            mkdir($destination, 0775, true);
        }

        $items = scandir($source);
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $src = $source . '/' . $item;
            $dest = $destination . '/' . $item;
            if (is_dir($src)) {
                $this->copyDirectory($src, $dest);
            } else {
                copy($src, $dest);
            }
        }
    }
}
