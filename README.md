# MiniWriter for Grav

MiniWriter est un éditeur Markdown minimaliste et mobile‑first pour Grav. Il ajoute une page d’édition côté site (front) protégée par l’authentification admin, pour créer et modifier des contenus rapidement depuis un mobile.

## Prérequis
- Grav 1.7+ recommandé
- Plugin Admin installé (pour vous authentifier)
- Un compte utilisateur ayant la permission `admin.login`

## Installation
1. Placez ce dossier dans `user/plugins/miniwriter`
2. Activez le plugin via l’Admin ou en créant `user/config/plugins/miniwriter.yaml`
3. Videz le cache si nécessaire

## Accès
- Ouvrez l’URL configurée, par défaut: `/miniwriter`
- Exemple: `https://votresite.tld/miniwriter`
- Si vous n’êtes pas connecté avec un compte autorisé, la page n’apparaît pas (le plugin ne s’active que pour les utilisateurs admin connectés).

## Configuration (user/config/plugins/miniwriter.yaml)
- `route`: chemin d’accès à la page MiniWriter (défaut: `/miniwriter`)
- `default_parent`: parent où créer les nouvelles pages (ex: `/blog`, défaut: `/`)
- `autosave_interval`: intervalle d’auto‑sauvegarde locale en secondes (défaut: 8)
- `markdown_toolbar`: active une petite barre de raccourcis Markdown (booléen)
- `allow_images`: autorise l’insertion rapide d’images (booléen)
- `default_published`: publie les nouveaux contenus par défaut (booléen)
- `conflict_prefix`: préfixe utilisé lors d’une duplication en cas de conflit (défaut: `(copie)`)
- `editor_font_size`: taille de police de l’éditeur (`small`, `medium`, `large`)
- `theme`: thème de l’éditeur (`auto`, `light`, `dark`)
- `server_preview`: active un éventuel aperçu rendu côté serveur (si supporté)

Vous pouvez modifier ces options dans l’Admin (Plugins > MiniWriter) ou via fichier YAML.

## Utilisation
- Page liste: montre les contenus récents (publiés et brouillons) sous le parent configuré, sinon tous les contenus.
- Nouveau: créez un contenu, choisissez le parent, titre, date, tags, statut publié, puis rédigez en Markdown.
- Éditer: ouvre un contenu existant; l’état local/serveur s’affiche pour faciliter la synchronisation.
- Sauvegarde locale: l’éditeur peut enregistrer périodiquement en local pour éviter les pertes.
- Envoi serveur: enregistre le fichier `.md` avec l’en‑tête YAML mis à jour (`title`, `date`, `tags`, `published`, `updated_at`, `created_at`).
- Conflits: si la version serveur a changé entre‑temps, MiniWriter le signale et vous propose d’écraser, de recharger ou de dupliquer.

## Lien de menu (facultatif)
Dans votre thème, vous pouvez afficher un lien vers MiniWriter uniquement pour les admins connectés. Exemple Twig dans votre navigation:

```
{% if grav.user and grav.user.authenticated and grav.user.authorize('admin.login') %}
  <li><a href="{{ base_url_absolute ~ config.plugins.miniwriter.route }}">MiniWriter</a></li>
{% endif %}
```

## Dépannage
- URL déjà utilisée: si une page existe à la même route, changez `route` dans la config.
- Rien ne s’affiche: vérifiez que vous êtes connecté à l’Admin et que vous avez `admin.login`.
- Cache: videz le cache Grav après installation/mise à jour.
- Version Grav: certaines API de collection ont changé selon les versions; le plugin fusionne désormais les listes publiées/non publiées de manière compatible.

## Sécurité
- MiniWriter n’est visible que pour les utilisateurs authentifiés disposant de `admin.login`.
- Aucune interface n’est ajoutée dans l’Admin; la page est générée côté site sur la route configurée.

## Licence
MIT
