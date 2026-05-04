import os

# Root project folder
root = "chess-analyzer"

# Structure definition
structure = {
    "": ["index.html", "style.css", "package.json"],
    "src": ["pgn-parser.js", "board.js", "engine.js", "app.js"],
    "assets/pieces": [],
    "electron": ["main.js"]
}

# Create folders and files
for folder, files in structure.items():
    folder_path = os.path.join(root, folder)
    os.makedirs(folder_path, exist_ok=True)

    for file in files:
        file_path = os.path.join(folder_path, file)
        with open(file_path, "w") as f:
            f.write("")  # empty file

print("Project structure created successfully!")