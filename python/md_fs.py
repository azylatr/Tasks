import os

def format_file_size(__file__: str) -> str:
    """
    Converts the file size in bytes to a more readable format (such as KB, MB, GB, etc.).
    Args:
        file_size (int): File size in bytes.
    Returns:
        str: The file size formatted in appropriate units (example: "1.23 MB").
    Example of use:
        file_path = "./index.py" # Add to file path
        print(format_file_size(file_path)) # Output: "1.00 MB"
    """
    units = ["bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    size = os.path.getsize(__file__) # Take the path
    i: int = 0
    while size >= 1024 and i < len(units) - 1:
        size /= 1024
        i += 1
    return f"{size:.2f} {units[i]}"
