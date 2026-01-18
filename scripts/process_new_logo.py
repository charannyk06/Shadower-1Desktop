
from PIL import Image
import numpy as np

def process_logo(input_path, output_path):
    print(f"Processing {input_path}...")
    try:
        img = Image.open(input_path).convert("RGBA")
        datas = img.getdata()
        
        # PROBABILITY CHECK: Does this image have a checkerboard?
        # Checkerboards are usually repeated squares of white/grey.
        # We will assume the user wants the "Dark" pixels (the logo) and wants to drop the "Light" pixels (checkerboard/white)
        
        newData = []
        for item in datas:
            # Simple threshold: If pixel is bright (light grey or white), make it transparent
            # Logos are usually dark. Checkerboards are usually light grey (e.g. 204, 204, 204) and white (255, 255, 255)
            # We cut off anything brighter than "Dark Grey"
            if item[0] > 180 and item[1] > 180 and item[2] > 180:
                newData.append((255, 255, 255, 0))
            else:
                newData.append(item)
        
        img.putdata(newData)
        
        # Crop
        bbox = img.getbbox()
        if bbox:
            img = img.crop(bbox)
            
        img.save(output_path, "PNG")
        print(f"Saved extracted logo to {output_path}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    input_file = "/Users/charannsrinivas/.gemini/antigravity/brain/facfb508-f97e-40df-a490-ccb235bb7cd8/uploaded_image_1767979849226.jpg"
    output_file = "/Users/charannsrinivas/Documents/Shadower-1/public/logo.png"
    process_logo(input_file, output_file)
