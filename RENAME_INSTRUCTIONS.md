# Repository Rename Instructions

Follow these steps to rename from `certification_flashcards_generator` to `azure-cert-flashcards`.

## 1. Rename on GitHub

1. Go to your repository on GitHub
2. Click **Settings** (top navigation)
3. In the **General** section, find the **Repository name** field
4. Change it to: `azure-cert-flashcards`
5. Click **Rename**

GitHub automatically:
- Redirects the old URL to the new one
- Updates GitHub Pages URL to: `https://YOUR-USERNAME.github.io/azure-cert-flashcards/`
- Preserves all issues, PRs, and history

## 2. Update Your Local Repository

```bash
# Navigate to your local repository
cd /path/to/certification_flashcards_generator

# Update the remote URL
git remote set-url origin https://github.com/YOUR-USERNAME/azure-cert-flashcards.git

# Verify the change
git remote -v

# Optional: rename your local directory
cd ..
mv certification_flashcards_generator azure-cert-flashcards
cd azure-cert-flashcards
```

## 3. Update References in Code

Replace `YOUR-USERNAME` in these files with your actual GitHub username:

- `/web/package.json` (repository, bugs, homepage URLs)
- `/README.md` (live demo link)

Example:
```bash
# Replace all instances (macOS/Linux)
find . -type f \( -name "*.json" -o -name "*.md" \) -exec sed -i '' 's/YOUR-USERNAME/youractualusername/g' {} +

# Or on Linux without macOS-specific flag
find . -type f \( -name "*.json" -o -name "*.md" \) -exec sed -i 's/YOUR-USERNAME/youractualusername/g' {} +
```

Or manually edit:
- [web/package.json](web/package.json) - lines with repository, bugs, homepage
- [README.md](README.md) - live demo link

## 4. Commit the Changes

```bash
git add .
git commit -m "Update repository references to azure-cert-flashcards"
git push
```

## 5. Verify

After renaming and pushing:

1. Check that your repository is accessible at: `https://github.com/YOUR-USERNAME/azure-cert-flashcards`
2. Wait a few minutes, then verify GitHub Pages is live at: `https://YOUR-USERNAME.github.io/azure-cert-flashcards/`
3. Update any bookmarks or external links to use the new URL

## Notes

- Old repository URLs automatically redirect to the new name
- GitHub Pages will automatically redeploy with the new base path
- All existing git clones will continue to work due to GitHub's redirect
- Update CI/CD configurations if you have external integrations

## After Verification

Once everything works, you can delete this file:
```bash
rm RENAME_INSTRUCTIONS.md
git commit -am "Remove rename instructions"
git push
```
