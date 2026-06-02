# 🎵 TuneGuess

**TuneGuess** est un jeu musical interactif et auto-hébergé où les joueurs doivent deviner des chansons le plus rapidement possible. Propulsé par l'**API Spotify**, le projet est entièrement conteneurisé avec **Docker** pour un déploiement simple et rapide sur n'importe quel serveur ou home-lab.

---

## 🚀 Fonctionnalités

* 🔌 **Intégration Spotify** : Synchronisation avec vos playlists et titres favoris via l'API Spotify Web.
* ⚡ **Stack Moderne** : Frontend ultra-réactif développé avec **Vue.js / Nuxt** et un backend robuste sous **Node.js**.
* 🐳 **Prêt pour le Self-Hosting** : Déploiement en une seule commande grâce à **Docker Compose**.
* 🎮 **Multijoueur en temps réel** : (Ajoute ici si tu gères du WebSocket/temps réel pour jouer à plusieurs).

---

## 🛠️ Stack Technique

* **Frontend** : Vue.js / Nuxt (SSR/SPA)
* **Backend** : Node.js (Express / Fastify)
* **Conteneurisation** : Docker & Docker Compose
* **API** : Spotify Web API

---

## 📋 Prérequis

Avant de lancer le projet, vous aurez besoin de :
* **Docker** et **Docker Compose** installés sur votre machine.
* Un compte **Spotify Developer** pour récupérer vos identifiants API.

### Création de l'application Spotify :
1. Rendez-vous sur le [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Créez une nouvelle application.
3. Ajoutez l'URL de redirection suivante dans les paramètres de votre application Spotify :
   `http://localhost:3000/api/callback` (à adapter selon votre configuration).
4. Récupérez le **Client ID** et le **Client Secret**.

---

## ⚙️ Configuration

Créez un fichier `.env` à la racine du projet et complétez les variables suivantes :

```env
TODO : faire le .env
